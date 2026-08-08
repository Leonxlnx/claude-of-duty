import { GLSL_NOISE, GLSL_PACK } from './noise.glsl.js';

const DEPTH_UTILS = /* glsl */`
uniform vec2 uProjParams;   // x: near, y: far
uniform mat4 uInvProjection;
uniform mat4 uProjection;
uniform vec2 uTexelSize;

float linearizeDepth(float d){
  float z = d * 2.0 - 1.0;
  return (2.0 * uProjParams.x * uProjParams.y) / (uProjParams.y + uProjParams.x - z * (uProjParams.y - uProjParams.x));
}

vec3 viewPosFromDepth(vec2 uv, float rawDepth){
  vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 v = uInvProjection * ndc;
  return v.xyz / v.w;
}
`;

/** direct + ambient*AO, plus a reactive-mask seed for TAA. */
export const COMBINE_FRAG = /* glsl */`
uniform sampler2D uDirect;
uniform sampler2D uAmbient;
uniform sampler2D uAO;
uniform float uAOStrength;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main(){
  vec4 d = texture(uDirect, vUv);
  vec4 a = texture(uAmbient, vUv);
  float ao = texture(uAO, vUv).r;
  ao = mix(1.0, ao, uAOStrength);
  // AO only attenuates indirect light; direct sun keeps its contact definition
  vec3 c = d.rgb + a.rgb * ao;
  outColor = vec4(c, d.a);
}
`;

export const GTAO_FRAG = /* glsl */`
${GLSL_NOISE}
${GLSL_PACK}
${DEPTH_UTILS}

uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform sampler2D uVelocity;
uniform mat3 viewMatrix3;   // world -> view rotation
uniform float uRadius;
uniform float uIntensity;
uniform int uSamples;
uniform float uFrameIndex;
in vec2 vUv;
layout(location = 0) out vec4 outAO;

const float PI = 3.14159265;

void main(){
  float rawDepth = texture(uDepth, vUv).r;
  if(rawDepth >= 0.99999){ outAO = vec4(1.0, 1.0, 0.0, 1.0); return; }

  vec3 P = viewPosFromDepth(vUv, rawDepth);
  vec4 nrm = texture(uNormal, vUv);
  vec3 Nw = octDecode(nrm.rg);
  vec3 N = normalize((viewMatrix3 * Nw));
  vec3 V = normalize(-P);

  // Screen-space radius from the world radius at this depth.
  float projScale = uProjection[1][1] * 0.5;
  float radiusPixels = uRadius * projScale / max(-P.z, 0.05);
  radiusPixels = clamp(radiusPixels, 3.0 * uTexelSize.y, 0.12);

  // rotating pattern: spatial hash x temporal golden-ratio offset
  float noise = hash12(gl_FragCoord.xy + uFrameIndex * 13.7);
  float rotation = noise * PI * 2.0;
  float offset = fract(noise + uFrameIndex * 0.6180339887);

  // Horizon-based occlusion: per direction find the largest elevation angle
  // above the tangent plane, then integrate the uncovered hemisphere.
  float occlusion = 0.0;
  int directions = uSamples;
  int steps = 4;
  float invDir = 1.0 / float(directions);
  float bias = 0.12;
  float aspect = uTexelSize.y / uTexelSize.x;

  for(int d=0; d<12; d++){
    if(d >= directions) break;
    float angle = float(d) * PI * 2.0 * invDir + rotation;
    vec2 dir = vec2(cos(angle) / aspect, sin(angle));

    float tangentSin = -bias;
    float highestSin = tangentSin;
    float dirOcclusion = 0.0;

    for(int s=1; s<=8; s++){
      if(s > steps) break;
      float stepFrac = (float(s) - 1.0 + offset) / float(steps);
      vec2 uvS = vUv + dir * radiusPixels * stepFrac;
      if(uvS.x <= 0.0 || uvS.x >= 1.0 || uvS.y <= 0.0 || uvS.y >= 1.0) continue;
      float dep = texture(uDepth, uvS).r;
      if(dep >= 0.99999) continue;

      vec3 S = viewPosFromDepth(uvS, dep) - P;
      float len = length(S);
      if(len < 1e-4 || len > uRadius * 2.2) continue;
      float sinH = dot(S / len, N);
      if(sinH > highestSin){
        float falloff = 1.0 - clamp(len / (uRadius * 2.0), 0.0, 1.0);
        falloff *= falloff;
        dirOcclusion += (sinH - highestSin) * falloff;
        highestSin = sinH;
      }
    }
    occlusion += dirOcclusion;
  }

  float visibility = clamp(1.0 - occlusion * invDir * uIntensity, 0.0, 1.0);
  visibility = pow(visibility, 1.35);

  // suppress AO where the surface is moving fast (avoids smearing)
  vec2 vel = texture(uVelocity, vUv).rg;
  float velLen = length(vel) * 60.0;
  visibility = mix(visibility, 1.0, clamp(velLen*0.6, 0.0, 0.55));

  outAO = vec4(visibility, -P.z, 0.0, 1.0);
}
`;

export const AO_BLUR_FRAG = /* glsl */`
uniform sampler2D uAO;
uniform vec2 uDirection;
uniform vec2 uTexelSize;
in vec2 vUv;
layout(location = 0) out vec4 outAO;

void main(){
  vec4 c = texture(uAO, vUv);
  float centerDepth = c.g;
  float sum = c.r;
  float wsum = 1.0;
  for(int i=1;i<=4;i++){
    float w = exp(-float(i*i) * 0.16);
    vec2 o = uDirection * uTexelSize * float(i);
    vec4 a = texture(uAO, vUv + o);
    vec4 b = texture(uAO, vUv - o);
    float wa = w * exp(-abs(a.g - centerDepth) * 4.0);
    float wb = w * exp(-abs(b.g - centerDepth) * 4.0);
    sum += a.r*wa + b.r*wb;
    wsum += wa + wb;
  }
  outAO = vec4(sum/wsum, centerDepth, 0.0, 1.0);
}
`;

export const AO_TEMPORAL_FRAG = /* glsl */`
uniform sampler2D uAO;
uniform sampler2D uHistory;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
in vec2 vUv;
layout(location = 0) out vec4 outAO;

void main(){
  vec4 cur = texture(uAO, vUv);
  vec2 vel = texture(uVelocity, vUv).rg;
  vec2 prevUv = vUv - vel;
  if(prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0){
    outAO = cur; return;
  }
  vec4 hist = texture(uHistory, prevUv);
  float depthDiff = abs(hist.g - cur.g) / max(cur.g, 0.1);
  float trust = exp(-depthDiff * 12.0) * (1.0 - clamp(length(vel)*40.0, 0.0, 1.0));

  // neighbourhood clamp keeps the history from leaking across silhouettes
  float mn = 1.0, mx = 0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    float s = texture(uAO, vUv + vec2(float(x),float(y))*uTexelSize).r;
    mn = min(mn, s); mx = max(mx, s);
  }
  float h = clamp(hist.r, mn - 0.06, mx + 0.06);
  outAO = vec4(mix(cur.r, h, 0.86 * trust), cur.g, 0.0, 1.0);
}
`;

export const TAA_FRAG = /* glsl */`
${GLSL_NOISE}
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uVelocity;
uniform sampler2D uDepth;
uniform vec2 uTexelSize;
uniform float uBlend;
uniform float uFirstFrame;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

vec3 rgb2ycocg(vec3 c){
  return vec3(0.25*c.r + 0.5*c.g + 0.25*c.b, 0.5*c.r - 0.5*c.b, -0.25*c.r + 0.5*c.g - 0.25*c.b);
}
vec3 ycocg2rgb(vec3 c){
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

void main(){
  vec4 cur = texture(uCurrent, vUv);
  if(uFirstFrame > 0.5){ outColor = cur; return; }

  // closest-depth velocity dilation removes velocity gaps on silhouettes
  vec2 bestUv = vUv;
  float bestDepth = 1.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 uv = vUv + vec2(float(x),float(y))*uTexelSize;
    float d = texture(uDepth, uv).r;
    if(d < bestDepth){ bestDepth = d; bestUv = uv; }
  }
  vec2 vel = texture(uVelocity, bestUv).rg;
  vec2 prevUv = vUv - vel;

  if(prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0){
    outColor = cur; return;
  }

  // 3x3 variance clipping in YCoCg
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  vec3 minC = vec3(1e9), maxC = vec3(-1e9);
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      vec3 s = rgb2ycocg(texture(uCurrent, vUv + vec2(float(x),float(y))*uTexelSize).rgb);
      m1 += s; m2 += s*s;
      minC = min(minC, s); maxC = max(maxC, s);
    }
  }
  vec3 mean = m1/9.0;
  vec3 sigma = sqrt(max(m2/9.0 - mean*mean, 0.0));
  float gamma = 1.35;
  vec3 lo = max(mean - gamma*sigma, minC);
  vec3 hi = min(mean + gamma*sigma, maxC);

  vec4 histSample = texture(uHistory, prevUv);
  vec3 hist = rgb2ycocg(histSample.rgb);
  vec3 clipped = clamp(hist, lo, hi);
  float clipAmount = length(clipped - hist);

  float reactive = cur.a;
  float velLen = length(vel / uTexelSize);
  float blend = uBlend;
  blend *= 1.0 - clamp(reactive, 0.0, 1.0);              // particles/flash keep the current frame
  // Fast pixels trust history less — and a flick has to be able to drop it
  // almost entirely. This capped at 0.6, so whipping the view left and right
  // still mixed 36% of a stale frame into every pixel, and the whole image
  // dragged behind the turn. That reads as the camera lagging rather than as
  // antialiasing. A turn moves hundreds of pixels per frame, so the ramp is
  // steeper too: by ~35px/frame the history is essentially gone.
  blend *= 1.0 - clamp(velLen * 0.028, 0.0, 0.97);
  blend *= 1.0 - clamp(clipAmount * 2.2, 0.0, 0.75);      // disocclusion

  vec3 result = mix(rgb2ycocg(cur.rgb), clipped, blend);
  outColor = vec4(max(ycocg2rgb(result), vec3(0.0)), cur.a);
}
`;

export const TILE_MAX_FRAG = /* glsl */`
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
uniform int uTileSize;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){
  vec2 best = vec2(0.0);
  float bestLen = 0.0;
  for(int y=0;y<16;y++){
    if(y >= uTileSize) break;
    for(int x=0;x<16;x++){
      if(x >= uTileSize) break;
      vec2 uv = vUv + (vec2(float(x), float(y)) - float(uTileSize)*0.5) * uTexelSize;
      vec2 v = texture(uVelocity, uv).rg;
      float l = dot(v,v);
      if(l > bestLen){ bestLen = l; best = v; }
    }
  }
  outColor = vec4(best, 0.0, 1.0);
}
`;

export const TILE_DILATE_FRAG = /* glsl */`
uniform sampler2D uTiles;
uniform vec2 uTexelSize;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){
  vec2 best = vec2(0.0);
  float bestLen = 0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 v = texture(uTiles, vUv + vec2(float(x),float(y))*uTexelSize).rg;
    float l = dot(v,v);
    if(l > bestLen){ bestLen = l; best = v; }
  }
  outColor = vec4(best, 0.0, 1.0);
}
`;

export const MOTION_BLUR_FRAG = /* glsl */`
${GLSL_NOISE}
${DEPTH_UTILS}
uniform sampler2D uColor;
uniform sampler2D uVelocity;
uniform sampler2D uNeighborMax;
uniform sampler2D uDepth;
uniform float uStrength;
uniform int uSamples;
uniform float uFrameIndex;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

// Longest streak any pixel may draw, as a fraction of the frame. Without a
// ceiling the blur length is whatever the velocity buffer says, and a fast
// sprint past near geometry produces vectors long enough to drag one part of
// the image across another — the frame reads as torn rather than blurred.
//
// Halved from 0.022, which was 42 pixels of streak at 1080p. Camera rotation
// is the worst case and the most objectionable, because it is continuous and
// player-driven: flicking the view left and right smeared the entire frame,
// which reads as the picture breaking rather than as motion.
const float MAX_BLUR = 0.011;

vec2 capBlur(vec2 v){
  float len = length(v);
  return len > MAX_BLUR ? v * (MAX_BLUR / len) : v;
}

void main(){
  vec4 center = texture(uColor, vUv);
  vec2 nMax = capBlur(texture(uNeighborMax, vUv).rg * uStrength);
  float nLen = length(nMax / uTexelSize);
  if(nLen < 1.2){ outColor = center; return; }

  vec2 vel = capBlur(texture(uVelocity, vUv).rg * uStrength);
  float centerDepth = linearizeDepth(texture(uDepth, vUv).r);
  float jitter = hash12(gl_FragCoord.xy + uFrameIndex*7.3) - 0.5;

  vec3 sum = center.rgb;
  float weight = 1.0;
  int samples = uSamples;
  for(int i=1;i<=16;i++){
    if(i > samples) break;
    float t = (float(i) + jitter) / float(samples);
    vec2 offA = mix(vel, nMax, 0.65) * (t - 0.5) * 2.0;
    vec2 uvA = vUv + offA;
    if(uvA.x < 0.0 || uvA.x > 1.0 || uvA.y < 0.0 || uvA.y > 1.0) continue;
    float dA = linearizeDepth(texture(uDepth, uvA).r);
    // depth-aware: only let closer-or-similar samples bleed in
    float w = (dA < centerDepth + 0.6) ? 1.0 : 0.25;
    w *= 1.0 - t*0.35;
    sum += texture(uColor, uvA).rgb * w;
    weight += w;
  }
  outColor = vec4(sum/weight, center.a);
}
`;

export const BLOOM_PREFILTER_FRAG = /* glsl */`
uniform sampler2D uColor;
uniform sampler2D uExposure;
uniform float uThreshold;
uniform float uSoftKnee;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){
  vec3 c = texture(uColor, vUv).rgb;
  float ev = texture(uExposure, vec2(0.5)).r;
  c *= ev;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uSoftKnee + 1e-5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0*knee);
  soft = soft*soft/(4.0*knee);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  outColor = vec4(c * contrib, 1.0);
}
`;

/** 13-tap Karis-average downsample (fireflies removed at the first level). */
export const BLOOM_DOWN_FRAG = /* glsl */`
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uKaris;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float karisWeight(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }

void main(){
  vec2 t = uTexelSize;
  vec3 a = texture(uSource, vUv + vec2(-2,-2)*t).rgb;
  vec3 b = texture(uSource, vUv + vec2( 0,-2)*t).rgb;
  vec3 c = texture(uSource, vUv + vec2( 2,-2)*t).rgb;
  vec3 d = texture(uSource, vUv + vec2(-2, 0)*t).rgb;
  vec3 e = texture(uSource, vUv).rgb;
  vec3 f = texture(uSource, vUv + vec2( 2, 0)*t).rgb;
  vec3 g = texture(uSource, vUv + vec2(-2, 2)*t).rgb;
  vec3 h = texture(uSource, vUv + vec2( 0, 2)*t).rgb;
  vec3 i = texture(uSource, vUv + vec2( 2, 2)*t).rgb;
  vec3 j = texture(uSource, vUv + vec2(-1,-1)*t).rgb;
  vec3 k = texture(uSource, vUv + vec2( 1,-1)*t).rgb;
  vec3 l = texture(uSource, vUv + vec2(-1, 1)*t).rgb;
  vec3 m = texture(uSource, vUv + vec2( 1, 1)*t).rgb;

  vec3 g0 = (j+k+l+m) * 0.25;
  vec3 g1 = (a+b+d+e) * 0.25;
  vec3 g2 = (b+c+e+f) * 0.25;
  vec3 g3 = (d+e+g+h) * 0.25;
  vec3 g4 = (e+f+h+i) * 0.25;

  vec3 result;
  if(uKaris > 0.5){
    float w0 = karisWeight(g0)*0.5, w1 = karisWeight(g1)*0.125;
    float w2 = karisWeight(g2)*0.125, w3 = karisWeight(g3)*0.125, w4 = karisWeight(g4)*0.125;
    float wsum = w0+w1+w2+w3+w4;
    result = (g0*w0 + g1*w1 + g2*w2 + g3*w3 + g4*w4) / max(wsum, 1e-5);
  } else {
    result = g0*0.5 + (g1+g2+g3+g4)*0.125;
  }
  outColor = vec4(result, 1.0);
}
`;

export const BLOOM_UP_FRAG = /* glsl */`
uniform sampler2D uSource;
uniform sampler2D uPrevious;
uniform vec2 uTexelSize;
uniform float uRadius;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){
  vec2 t = uTexelSize * uRadius;
  vec3 s = texture(uSource, vUv + vec2(-1,-1)*t).rgb * 1.0;
  s += texture(uSource, vUv + vec2( 0,-1)*t).rgb * 2.0;
  s += texture(uSource, vUv + vec2( 1,-1)*t).rgb * 1.0;
  s += texture(uSource, vUv + vec2(-1, 0)*t).rgb * 2.0;
  s += texture(uSource, vUv).rgb * 4.0;
  s += texture(uSource, vUv + vec2( 1, 0)*t).rgb * 2.0;
  s += texture(uSource, vUv + vec2(-1, 1)*t).rgb * 1.0;
  s += texture(uSource, vUv + vec2( 0, 1)*t).rgb * 2.0;
  s += texture(uSource, vUv + vec2( 1, 1)*t).rgb * 1.0;
  s /= 16.0;
  outColor = vec4(s + texture(uPrevious, vUv).rgb, 1.0);
}
`;

export const LUMINANCE_FRAG = /* glsl */`
uniform sampler2D uColor;
uniform vec2 uTexelSize;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){
  vec3 c = vec3(0.0);
  c += texture(uColor, vUv + vec2(-0.5,-0.5)*uTexelSize).rgb;
  c += texture(uColor, vUv + vec2( 0.5,-0.5)*uTexelSize).rgb;
  c += texture(uColor, vUv + vec2(-0.5, 0.5)*uTexelSize).rgb;
  c += texture(uColor, vUv + vec2( 0.5, 0.5)*uTexelSize).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(log2(max(l, 1e-4)), l, 0.0, 1.0);
}
`;

export const LUMINANCE_DOWN_FRAG = /* glsl */`
uniform sampler2D uSource;
uniform vec2 uTexelSize;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){
  vec4 c = texture(uSource, vUv + vec2(-0.5,-0.5)*uTexelSize);
  c += texture(uSource, vUv + vec2( 0.5,-0.5)*uTexelSize);
  c += texture(uSource, vUv + vec2(-0.5, 0.5)*uTexelSize);
  c += texture(uSource, vUv + vec2( 0.5, 0.5)*uTexelSize);
  outColor = c * 0.25;
}
`;

export const EXPOSURE_FRAG = /* glsl */`
uniform sampler2D uLuminance;
uniform sampler2D uPrevExposure;
uniform float uDeltaTime;
uniform float uBrightenSpeed;
uniform float uDarkenSpeed;
uniform float uCompensation;
uniform float uMinEV;
uniform float uMaxEV;
uniform float uReset;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main(){
  float logL = texture(uLuminance, vec2(0.5)).r;
  float avgL = exp2(logL);
  // Scene radiance is normalised so a fully sunlit white surface sits near 1.0.
  //
  // The key is what the average of the frame is mapped to. 18% is the textbook
  // answer and it is the wrong one here: this scene is a sunlit desert street,
  // so the average IS the sunlit ground, and keying it to middle grey made
  // sunlit sand render at middle grey. Measured, it landed around 118 sRGB
  // with nothing in the whole frame above 196 — no highlight anywhere, and a
  // midday street that photographed like an overcast afternoon. A bright scene
  // should key bright; AgX has the shoulder to take it.
  float ev = log2(max(avgL, 1e-5) / 0.38);
  ev = clamp(ev - uCompensation, uMinEV, uMaxEV);
  float targetExposure = exp2(-ev);

  float prev = texture(uPrevExposure, vec2(0.5)).r;
  if(uReset > 0.5 || prev <= 0.0){ outColor = vec4(targetExposure, ev, 0.0, 1.0); return; }

  float speed = targetExposure > prev ? uBrightenSpeed : uDarkenSpeed;
  float adapted = prev + (targetExposure - prev) * (1.0 - exp(-uDeltaTime * speed));
  outColor = vec4(adapted, ev, 0.0, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */`
${GLSL_NOISE}
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform sampler2D uExposure;
uniform sampler3D uLut;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uGrain;
uniform float uChromatic;
uniform float uSharpen;
uniform float uLutSize;
uniform float uDamageFlash;
uniform vec2 uDamageDir;
uniform float uCriticalHealth;
uniform float uExposureOverride;
uniform float uLensDirt;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

// AgX — Troy Sobotka's curve, log-encoded rotation + sigmoid + inverse rotation.
const mat3 AGX_IN = mat3(
  0.8424790, 0.0784336, 0.0792237,
  0.0423282, 0.8784686, 0.0791661,
  0.0423756, 0.0784336, 0.8791430
);
const mat3 AGX_OUT = mat3(
   1.1968790, -0.0980210, -0.0990297,
  -0.0528968,  1.1519107, -0.0989636,
  -0.0529716, -0.0980434,  1.1508920
);

vec3 agxDefaultContrast(vec3 x){
  vec3 x2 = x*x;
  vec3 x4 = x2*x2;
  return + 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232;
}

vec3 agx(vec3 col){
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  col = AGX_IN * col;
  col = clamp(log2(max(col, 1e-10)), minEv, maxEv);
  col = (col - minEv) / (maxEv - minEv);
  col = agxDefaultContrast(col);
  // slight look: lift saturation back after the sigmoid flattens it
  col = AGX_OUT * col;
  float l = luma(col);
  col = mix(vec3(l), col, 1.06);
  return clamp(col, 0.0, 1.0);
}

void main(){
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);

  float exposure = texture(uExposure, vec2(0.5)).r;
  if(uExposureOverride > 0.0) exposure = uExposureOverride;

  // Chromatic separation grows toward the frame edge — and only there.
  //
  // The constant term meant every pixel got separation, including the middle
  // of the frame, which is not something a lens does. On thin high-contrast
  // geometry at the sample rate — window grilles, railings, awning posts — it
  // pushed alternating bars to fully saturated red and blue, so a barred
  // window read as candy stripes rather than as dark metal. Quadratic from
  // zero at the centre, and weaker overall.
  // Halved again, and the offset is capped: at 0.020 the extreme corner still
  // separated the channels by over two pixels, which on one-pixel geometry —
  // window grilles, power lines, antennas — resolves as fully saturated orange
  // and cyan pixels rather than as a fringe on dark metal. A lens fringe you
  // can name the colour of is too strong.
  vec3 hdr;
  float ca = min(uChromatic * r2 * r2 * 0.010, 0.00035);
  if(ca > 1e-5){
    hdr.r = texture(uColor, uv + centered * ca).r;
    hdr.g = texture(uColor, uv).g;
    hdr.b = texture(uColor, uv - centered * ca).b;
  } else {
    hdr = texture(uColor, uv).rgb;
  }

  if(uSharpen > 0.001){
    vec2 t = 1.0/uResolution;
    vec3 blur = texture(uColor, uv + vec2(t.x,0)).rgb + texture(uColor, uv - vec2(t.x,0)).rgb
              + texture(uColor, uv + vec2(0,t.y)).rgb + texture(uColor, uv - vec2(0,t.y)).rgb;
    hdr += (hdr - blur*0.25) * uSharpen;
    hdr = max(hdr, vec3(0.0));
  }

  vec3 bloom = texture(uBloom, uv).rgb;
  float dirt = 0.55 + 0.45 * fbm(uv * vec2(7.0, 4.0), 3, 0.6);
  hdr = hdr * exposure + bloom * uBloomStrength * mix(1.0, dirt, uLensDirt);

  vec3 col = agx(hdr);

  // 33^3 procedural grading LUT
  float scale = (uLutSize - 1.0) / uLutSize;
  float offset = 1.0 / (2.0 * uLutSize);
  col = texture(uLut, clamp(col, 0.0, 1.0) * scale + offset).rgb;

  // critical health: desaturate + redden the periphery, keep the centre readable
  if(uCriticalHealth > 0.001){
    float edge = smoothstep(0.05, 0.42, r2);
    float l = luma(col);
    col = mix(col, vec3(l), uCriticalHealth * 0.55 * mix(0.4, 1.0, edge));
    col = mix(col, col * vec3(1.25, 0.42, 0.38), uCriticalHealth * edge * 0.85);
    col *= 1.0 - uCriticalHealth * edge * 0.35;
  }

  // directional damage flash
  if(uDamageFlash > 0.001){
    float d = dot(normalize(centered + vec2(1e-5)), uDamageDir);
    float arc = smoothstep(0.1, 1.0, d) * smoothstep(0.02, 0.3, r2);
    col = mix(col, vec3(0.78, 0.09, 0.07), clamp(uDamageFlash * (0.25 + arc*0.9), 0.0, 0.85));
  }

  float vig = 1.0 - uVignette * smoothstep(0.12, 0.78, r2);
  col *= vig;

  if(uGrain > 0.001){
    float n = hash12(gl_FragCoord.xy + fract(uTime)*311.7) - 0.5;
    col += n * uGrain * 0.035 * (1.0 - luma(col)*0.6);
  }

  // Output dither, immediately before the 8-bit write.
  //
  // The sky is a slow gradient across nine hundred pixels, so quantising it to
  // 8 bits laid down 40-60 pixel plateaus of a single value with 1-LSB steps
  // between them: visible banding across the whole upper field. Grain hides it
  // only when grain is on, and it is a setting. A triangular-PDF dither of one
  // LSB is the standard fix — the difference of two uniform samples gives the
  // triangular distribution, which decorrelates the error from the signal
  // instead of just adding noise to it. Below perception on its own, and TAA
  // averages what little is left.
  float d1 = hash12(gl_FragCoord.xy + fract(uTime) * 173.3);
  float d2 = hash12(gl_FragCoord.xy + 57.31 + fract(uTime) * 419.7);
  col += (d1 - d2) / 255.0;

  outColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

/** Debug visualiser for the intermediate render targets. */
export const DEBUG_FRAG = /* glsl */`
${GLSL_PACK}
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform sampler2D uVelocity;
uniform sampler2D uAO;
uniform sampler2D uDepth;
uniform sampler2D uDirect;
uniform sampler2D uAmbient;
uniform sampler2D uBloom;
uniform highp sampler2DArray uShadowMap;
uniform int uMode;
uniform float uCascadeCount;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main(){
  vec3 c = vec3(0.0);
  if(uMode == 1){ c = octDecode(texture(uNormal, vUv).rg)*0.5+0.5; }
  else if(uMode == 2){ vec2 v = texture(uVelocity, vUv).rg; c = vec3(abs(v)*40.0, 0.0); }
  else if(uMode == 3){ c = vec3(texture(uAO, vUv).r); }
  else if(uMode == 4){ float d = texture(uDepth, vUv).r; c = vec3(pow(d, 40.0)); }
  else if(uMode == 5){ c = texture(uDirect, vUv).rgb; }
  else if(uMode == 6){ c = texture(uAmbient, vUv).rgb; }
  else if(uMode == 7){ c = texture(uBloom, vUv).rgb; }
  else if(uMode == 8){
    vec2 uv = fract(vUv * 2.0);
    float idx = floor(vUv.x*2.0) + floor(vUv.y*2.0)*2.0;
    c = vec3(texture(uShadowMap, vec3(uv, min(idx, uCascadeCount-1.0))).r);
    c = pow(c, vec3(24.0));
  }
  else if(uMode == 9){ c = vec3(texture(uNormal, vUv).b); }
  else { c = texture(uColor, vUv).rgb; }
  outColor = vec4(c, 1.0);
}
`;

export const BLIT_FRAG = /* glsl */`
uniform sampler2D uSource;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main(){ outColor = texture(uSource, vUv); }
`;

export { DEPTH_UTILS };
