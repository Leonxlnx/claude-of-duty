import { GLSL_NOISE, GLSL_PACK } from './noise.glsl.js';

/** Shared lighting code used by the world, character, prop and viewmodel shaders. */
export const GLSL_LIGHTING = /* glsl */`
${GLSL_PACK}

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkySH[9];
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
uniform vec3 uGroundColor;
uniform float uCloudShadowStrength;
uniform vec2 uCloudShadowOffset;
uniform float uTime;

uniform highp sampler2DArray uShadowMap;
uniform mat4 uCascadeMatrix[4];
uniform vec4 uCascadeSplits;
uniform float uShadowTexel;
uniform int uCascadeCount;
uniform float uShadowStrength;

uniform vec4 uPointLights[8];   // xyz position, w radius
uniform vec4 uPointColors[8];   // rgb colour * intensity, w unused
uniform int uPointLightCount;

uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCameraPos;

const float PI = 3.141592653589793;

vec3 shIrradiance(vec3 n){
  vec3 r = uSkySH[0] * 0.886227;
  r += uSkySH[1] * (2.0*0.511664) * n.y;
  r += uSkySH[2] * (2.0*0.511664) * n.z;
  r += uSkySH[3] * (2.0*0.511664) * n.x;
  r += uSkySH[4] * (2.0*0.429043) * n.x * n.y;
  r += uSkySH[5] * (2.0*0.429043) * n.y * n.z;
  r += uSkySH[6] * (0.743125 * n.z * n.z - 0.247708);
  r += uSkySH[7] * (2.0*0.429043) * n.x * n.z;
  r += uSkySH[8] * (0.429043) * (n.x*n.x - n.y*n.y);
  return max(r, vec3(0.0)) / PI;
}

// Analytic sky colour along a direction — used for ambient specular.
vec3 skyProbe(vec3 d){
  float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
  vec3 c = mix(uHorizonColor, uZenithColor, pow(h, 0.6));
  c = mix(uGroundColor, c, smoothstep(-0.14, 0.06, d.y));
  float sun = max(dot(d, uSunDirection), 0.0);
  c += uSunColor * pow(sun, 220.0) * 1.4;
  c += uSunColor * pow(sun, 8.0) * 0.045;
  return c;
}

float cloudShadow(vec3 worldPos){
  if(uCloudShadowStrength <= 0.001) return 1.0;
  vec2 p = worldPos.xz * 0.0072 + uCloudShadowOffset;
  float n = fbm(p, 4, 0.55);
  float s = smoothstep(0.42, 0.68, n);
  return mix(1.0, 1.0 - uCloudShadowStrength, s);
}

float sampleCascade(vec3 worldPos, int cascade, float ndl, vec3 normal){
  vec4 lp = uCascadeMatrix[cascade] * vec4(worldPos + normal * (0.035 + float(cascade)*0.055), 1.0);
  vec3 proj = lp.xyz / lp.w;
  proj = proj * 0.5 + 0.5;
  if(proj.x < 0.002 || proj.x > 0.998 || proj.y < 0.002 || proj.y > 0.998 || proj.z > 1.0) return 1.0;

  float slope = clamp(1.0 - ndl, 0.0, 1.0);
  float bias = (0.0009 + slope * 0.0032) * (1.0 + float(cascade)*1.6);
  float texel = uShadowTexel * (1.0 + float(cascade)*0.35);

  // rotated 3x3 optimised PCF
  float angle = hash12(floor(gl_FragCoord.xy)) * 6.2831853;
  float s = sin(angle), c = cos(angle);
  mat2 rot = mat2(c, -s, s, c);
  float sum = 0.0;
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      vec2 o = rot * vec2(float(x), float(y)) * texel;
      float d = texture(uShadowMap, vec3(proj.xy + o, float(cascade))).r;
      sum += (proj.z - bias <= d) ? 1.0 : 0.0;
    }
  }
  return sum / 9.0;
}

float sunShadow(vec3 worldPos, float viewDepth, float ndl, vec3 normal){
  if(uShadowStrength <= 0.001) return 1.0;
  int cascade = 3;
  if(viewDepth < uCascadeSplits.x) cascade = 0;
  else if(viewDepth < uCascadeSplits.y) cascade = 1;
  else if(viewDepth < uCascadeSplits.z) cascade = 2;
  if(cascade >= uCascadeCount) return 1.0;

  float s = sampleCascade(worldPos, cascade, ndl, normal);

  // blend into the next cascade over the last 12% of the range
  float splitEnd = cascade == 0 ? uCascadeSplits.x : cascade == 1 ? uCascadeSplits.y : cascade == 2 ? uCascadeSplits.z : uCascadeSplits.w;
  float splitStart = cascade == 0 ? 0.0 : cascade == 1 ? uCascadeSplits.x : cascade == 2 ? uCascadeSplits.y : uCascadeSplits.z;
  float t = (viewDepth - splitStart) / max(splitEnd - splitStart, 0.001);
  if(t > 0.86 && cascade + 1 < uCascadeCount){
    float s2 = sampleCascade(worldPos, cascade+1, ndl, normal);
    s = mix(s, s2, smoothstep(0.86, 1.0, t));
  }
  return mix(1.0, s, uShadowStrength);
}

vec3 fresnelSchlick(float cosTheta, vec3 f0){
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

float distributionGGX(float ndh, float rough){
  float a = rough*rough;
  float a2 = a*a;
  float d = ndh*ndh*(a2-1.0)+1.0;
  return a2 / max(PI*d*d, 1e-6);
}

float geometrySmith(float ndv, float ndl, float rough){
  float r = rough + 1.0;
  float k = (r*r)/8.0;
  float gv = ndv/(ndv*(1.0-k)+k);
  float gl = ndl/(ndl*(1.0-k)+k);
  return gv*gl;
}

// Split-sum environment BRDF approximation (Karis, mobile fit).
vec3 envBRDFApprox(vec3 f0, float rough, float ndv){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1;
  float a004 = min(r.x*r.x, exp2(-9.28*ndv)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

struct SurfaceOut { vec3 direct; vec3 ambient; };

/**
 * shadowFloor keeps a surface from going fully unlit no matter what the shadow
 * map says. Only the first-person weapon uses it; see the light rig note in
 * the fragment shader below.
 */
SurfaceOut shadeSurface(vec3 worldPos, vec3 N, vec3 V, vec3 albedo, float rough, float metal, float ao, float viewDepth, float shadowScale, float shadowFloor){
  SurfaceOut o;
  rough = clamp(rough, 0.035, 1.0);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 diffuseAlbedo = albedo * (1.0 - metal);
  float ndv = max(dot(N, V), 1e-4);

  // --- sun
  vec3 L = uSunDirection;
  float ndl = max(dot(N, L), 0.0);
  vec3 direct = vec3(0.0);
  if(ndl > 0.0){
    float sh = sunShadow(worldPos, viewDepth, ndl, N) * shadowScale;
    sh *= cloudShadow(worldPos);
    sh = max(sh, shadowFloor);
    if(sh > 0.001){
      vec3 H = normalize(L + V);
      float ndh = max(dot(N,H), 0.0);
      float vdh = max(dot(V,H), 0.0);
      vec3 F = fresnelSchlick(vdh, f0);
      float D = distributionGGX(ndh, rough);
      float G = geometrySmith(ndv, ndl, rough);
      vec3 spec = (D*G*F) / max(4.0*ndv*ndl, 1e-5);
      vec3 kd = (vec3(1.0)-F);
      direct += (kd*diffuseAlbedo/PI + spec) * uSunColor * ndl * sh;
    }
  }

  // --- dynamic point lights (muzzle flash, explosions, sparks)
  for(int i=0;i<8;i++){
    if(i >= uPointLightCount) break;
    vec3 d = uPointLights[i].xyz - worldPos;
    float dist2 = dot(d,d);
    float radius = uPointLights[i].w;
    if(dist2 > radius*radius) continue;
    float dist = sqrt(dist2);
    vec3 Lp = d / max(dist, 1e-4);
    float pndl = max(dot(N, Lp), 0.0);
    if(pndl <= 0.0) continue;
    float att = clamp(1.0 - dist/radius, 0.0, 1.0);
    att = att*att / (1.0 + dist*dist*0.35);
    vec3 H = normalize(Lp + V);
    float ndh = max(dot(N,H), 0.0);
    vec3 F = fresnelSchlick(max(dot(V,H),0.0), f0);
    float D = distributionGGX(ndh, rough);
    float G = geometrySmith(ndv, pndl, rough);
    vec3 spec = (D*G*F)/max(4.0*ndv*pndl, 1e-5);
    direct += ((vec3(1.0)-F)*diffuseAlbedo/PI + spec) * uPointColors[i].rgb * pndl * att;
  }

  // --- sky / bounce ambient
  vec3 irr = shIrradiance(N);
  vec3 ambient = diffuseAlbedo * irr * ao;

  // --- warm bounce off the ground
  //
  // A sunlit sand street throws a great deal of light back up, and it is the
  // colour of the sand. With sky irradiance as the only fill, everything in
  // shadow instead took the sky's blue whole — which is why pale concrete
  // barriers read as flat blue-grey slabs with no material identity at all,
  // and why the shaded sides of every building sat cold against a warm scene.
  // Strongest on downward-facing surfaces and near the ground, gone by the
  // time it reaches a roofline.
  float downward = clamp(0.5 - N.y * 0.5, 0.0, 1.0);
  float nearGround = 1.0 - smoothstep(0.0, 7.0, worldPos.y);
  vec3 bounce = vec3(0.62, 0.50, 0.33) * uSunColor * 0.20
    * downward * (0.30 + nearGround * 0.70);
  ambient += diffuseAlbedo * bounce * ao;
  vec3 R = reflect(-V, N);
  vec3 envSpec = skyProbe(normalize(mix(R, N, rough*rough*0.75)));
  float horizonFade = clamp(1.0 + dot(R, N), 0.0, 1.0);
  ambient += envSpec * envBRDFApprox(f0, rough, ndv) * ao * horizonFade * mix(0.35, 1.0, metal);

  o.direct = direct;
  o.ambient = ambient;
  return o;
}

vec3 applyAerial(vec3 color, float dist, vec3 viewDir){
  float f = 1.0 - exp(-dist * uFogDensity);
  float sunAmount = max(dot(viewDir, uSunDirection), 0.0);
  vec3 fog = mix(uFogColor, uFogColor * 1.25 + uSunColor * 0.06, pow(sunAmount, 6.0));
  return mix(color, fog, clamp(f, 0.0, 1.0));
}
`;

export const WORLD_VERT = /* glsl */`
precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;
in float aLayer;
in vec3 aTint;
in float aWear;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform mat4 uPrevViewProjection;
uniform mat4 uPrevModelMatrix;
uniform float uPrevModelValid;   // 0 for shared static materials, 1 for tracked dynamics
uniform vec4 uJitter;      // xy: current jitter, zw: previous jitter (clip space)

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out float vLayer;
out vec3 vTint;
out float vWear;
out vec4 vCurClip;
out vec4 vPrevClip;

void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  vLayer = aLayer;
  vTint = aTint;
  vWear = aWear;

  vec4 clip = projectionMatrix * viewMatrix * wp;
  vCurClip = clip;
  mat4 prevModel = uPrevModelValid > 0.5 ? uPrevModelMatrix : modelMatrix;
  vPrevClip = uPrevViewProjection * prevModel * vec4(position, 1.0);

  clip.xy += uJitter.xy * clip.w;
  gl_Position = clip;
}
`;

export const WORLD_FRAG = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2DArray;

${GLSL_NOISE}
${GLSL_LIGHTING}

uniform sampler2DArray uAlbedoArray;
uniform sampler2DArray uNormalArray;
uniform sampler2DArray uOrmArray;
uniform mat4 viewMatrix;
uniform vec4 uJitter;
uniform float uDetailStrength;
uniform float uViewmodelLight;   // 0 for the world, 1 for the first-person weapon

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in float vLayer;
in vec3 vTint;
in float vWear;
in vec4 vCurClip;
in vec4 vPrevClip;

layout(location = 0) out vec4 outDirect;
layout(location = 1) out vec4 outAmbient;
layout(location = 2) out vec4 outNormal;
layout(location = 3) out vec4 outVelocity;

/**
 * Stochastic tiling on a triangle lattice.
 *
 * A tileable texture stretched over a twenty metre facade repeats its crack
 * and chip pattern dozens of times, and the eye locks onto that grid instantly
 * — no amount of brightness variation hides it. So each cell of a lattice gets
 * its own random UV offset, which destroys the periodicity.
 *
 * The offset is discontinuous at cell borders, so the blend between cells has
 * to be exactly zero there or the seam shows as a hard edge. A triangle
 * lattice gives that for free: the barycentric weight of a vertex falls to
 * zero on the opposite edge, so every sample fades out before its own cell
 * ends. Weights are then sharpened, which keeps most pixels dominated by a
 * single tile — a plain linear blend of three samples averages away the
 * contrast the texture was authored with and leaves everything looking soft.
 *
 * Gradients come from the unoffset coordinate so the offsets do not tear the
 * mip chain at cell boundaries.
 */
vec2 tileOffset(vec2 cell){
  return vec2(hash12(cell), hash12(cell + 17.31));
}

struct TileBlend { vec2 uv1; vec2 uv2; vec2 uv3; vec3 w; vec2 dx; vec2 dy; };

TileBlend tileBlend(vec2 uv){
  TileBlend t;
  t.dx = dFdx(uv);
  t.dy = dFdy(uv);

  // Skew into a triangular lattice; 2*sqrt(3) makes cells roughly tile-sized.
  vec2 skewed = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
  vec2 base = floor(skewed);
  vec2 f = fract(skewed);

  vec2 v1, v2, v3;
  float rest = 1.0 - f.x - f.y;
  if(rest > 0.0){
    t.w = vec3(rest, f.y, f.x);
    v1 = base; v2 = base + vec2(0.0, 1.0); v3 = base + vec2(1.0, 0.0);
  } else {
    t.w = vec3(-rest, 1.0 - f.y, 1.0 - f.x);
    v1 = base + vec2(1.0, 1.0); v2 = base + vec2(1.0, 0.0); v3 = base + vec2(0.0, 1.0);
  }

  t.uv1 = uv + tileOffset(v1);
  t.uv2 = uv + tileOffset(v2);
  t.uv3 = uv + tileOffset(v3);

  vec3 w = t.w * t.w;      // sharpen toward a single dominant tile
  w *= w;
  t.w = w / max(w.x + w.y + w.z, 1e-5);
  return t;
}

vec4 tiled(sampler2DArray tex, TileBlend t, float layer){
  // Weights fall off fast enough that a tile under 2% contributes less than the
  // 8-bit textures can represent, so skipping it is free and most pixels end up
  // paying for one or two fetches rather than three.
  vec4 c = vec4(0.0);
  if(t.w.x > 0.02) c += t.w.x * textureGrad(tex, vec3(t.uv1, layer), t.dx, t.dy);
  if(t.w.y > 0.02) c += t.w.y * textureGrad(tex, vec3(t.uv2, layer), t.dx, t.dy);
  if(t.w.z > 0.02) c += t.w.z * textureGrad(tex, vec3(t.uv3, layer), t.dx, t.dy);
  return c / max(dot(t.w, step(vec3(0.02), t.w)), 1e-4);
}

vec3 perturbNormal(vec3 N, vec3 V, vec2 texcoord, vec3 mapN){
  vec3 q0 = dFdx(-V);
  vec3 q1 = dFdy(-V);
  vec2 st0 = dFdx(texcoord);
  vec2 st1 = dFdy(texcoord);
  vec3 T = normalize(q0 * st1.y - q1 * st0.y);
  vec3 B = normalize(-q0 * st1.x + q1 * st0.x);
  if(any(isnan(T)) || any(isnan(B))) return N;
  T = normalize(T - N * dot(N, T));
  B = cross(N, T);
  return normalize(mat3(T, B, N) * mapN);
}

void main(){
  float layer = vLayer;
  vec3 V = normalize(uCameraPos - vWorldPos);
  float viewDist = distance(uCameraPos, vWorldPos);

  TileBlend tb = tileBlend(vUv);
  vec4 alb = tiled(uAlbedoArray, tb, layer);
  vec4 nrm = tiled(uNormalArray, tb, layer);
  vec3 orm = tiled(uOrmArray, tb, layer).rgb;

  // meso-scale world-space break-up so tiling never reads as a grid
  float macro = fbm(vWorldPos.xz * 0.055 + vWorldPos.y * 0.021, 4, 0.55);
  float macro2 = fbm(vWorldPos.xz * 0.4 + 31.0, 3, 0.5);

  vec3 albedo = alb.rgb * vTint;
  albedo *= 0.86 + macro * 0.28;
  albedo *= 0.94 + macro2 * 0.12;

  // dust accumulation on upward faces, grime in crevices (linear reflectances)
  float up = clamp(vNormal.y, 0.0, 1.0);
  float dustMask = up * up * (0.35 + macro * 0.5) * (0.55 + vWear * 0.6);
  albedo = mix(albedo, vec3(0.255, 0.192, 0.108), clamp(dustMask * 0.42, 0.0, 0.5));

  float wear = clamp(vWear * (0.4 + macro * 1.2), 0.0, 1.0);
  albedo = mix(albedo, albedo * 0.72, wear * 0.4);

  // ---- weathering on vertical surfaces
  //
  // Every wall in the district met every floor on a razor-clean line, and no
  // facade carried a mark of any kind, so a street of them read as painted
  // card however much geometry was on it. Both are the same observation — real
  // walls are dirtiest where water and feet reach them — and both are cheap
  // here, because doing it in the shader weathers the whole map at once rather
  // than one prop at a time.
  float vertical = 1.0 - clamp(abs(vNormal.y) * 1.6, 0.0, 1.0);

  // Splash zone: the district floor sits near y=0, so height above it is a
  // good enough proxy for ground contact without sampling the terrain.
  float splash = (1.0 - smoothstep(0.0, 0.85, vWorldPos.y)) * vertical;
  splash *= 0.55 + macro2 * 0.7;
  albedo = mix(albedo, vec3(0.118, 0.094, 0.070), clamp(splash * 0.45, 0.0, 0.55));

  // Drip staining: vertical streaks that fade downward from wherever they
  // start, so sills, balconies and parapets all trail runs beneath them
  // without needing to know where any of them are.
  float streakNoise = fbm(vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y * 0.06) * 2.4, 3, 0.55);
  float streak = smoothstep(0.62, 0.95, streakNoise) * vertical;
  streak *= smoothstep(0.0, 2.2, vWorldPos.y) * (0.35 + vWear * 0.8);
  albedo = mix(albedo, albedo * vec3(0.62, 0.60, 0.56), clamp(streak * 0.5, 0.0, 0.5));

  // Blown render: patches where the plaster has come off, exposing a coarser,
  // greyer substrate. Sparse on purpose — this is an accent, not a texture.
  // (Not named "patch": that is a reserved word in GLSL and compiles nowhere.)
  float blown = smoothstep(0.74, 0.86, fbm(vWorldPos.xz * 0.32 + vWorldPos.y * 0.28 + 7.0, 3, 0.5));
  blown *= vertical * vWear;
  albedo = mix(albedo, vec3(0.40, 0.385, 0.355), clamp(blown * 0.6, 0.0, 0.6));

  // Dirt and exposed substrate are rougher than the render they sit on.
  float rough = clamp(orm.g * (0.9 + wear * 0.25) + dustMask * 0.16
    + splash * 0.22 + blown * 0.25, 0.04, 1.0);
  float metal = orm.b * (1.0 - dustMask * 0.5) * (1.0 - clamp(splash, 0.0, 1.0) * 0.6);
  float ao = orm.r;

  vec3 mapN = nrm.xyz * 2.0 - 1.0;
  mapN.xy *= uDetailStrength * mix(1.0, 0.35, clamp(viewDist / 60.0, 0.0, 1.0));
  vec3 N = perturbNormal(normalize(vNormal), V, vUv, normalize(mapN));

  float viewDepth = -(viewMatrix * vec4(vWorldPos, 1.0)).z;

  /**
   * Viewmodel light rig.
   *
   * A weapon carried through an alley spends most of a match in shade, and a
   * dark parkerised receiver lit only by the sky collapses into a black
   * silhouette against a sunlit street. That is technically correct and
   * completely unreadable — nobody's eye does that with an object 40cm from
   * their face. Shooters solve it with a light rig bolted to the view, and so
   * does this one: the sun keeps a floor so the gun holds its form, plus a
   * soft fill from over the player's shoulder. Both scale with the sky, so the
   * rig tracks the scene instead of looking pasted on.
   */
  float shadowFloor = uViewmodelLight * 0.55;
  SurfaceOut s = shadeSurface(vWorldPos, N, V, albedo, rough, metal, ao, viewDepth, 1.0, shadowFloor);

  vec3 direct = s.direct;
  vec3 ambient = s.ambient;

  if(uViewmodelLight > 0.0){
    // Wrapped key: the sun allowed partway round the form, added only where
    // the real sun cannot reach. The faces the player actually looks at point
    // at the camera, which is exactly where N.L gates the key light to zero —
    // without this the whole weapon is lit by nothing but sky.
    float ndlRaw = dot(N, uSunDirection);
    float wrapKey = max((ndlRaw + 0.6) / 1.6, 0.0) - max(ndlRaw, 0.0);
    direct += albedo * (1.0 - metal) / PI * uSunColor * wrapKey * 0.85;

    // Neutral fill from over the shoulder. Scaled by the sky's luminance so
    // it tracks exposure, but stripped of its colour: a fill carrying the
    // sky's blue is why a grey receiver kept rendering as navy.
    vec3 irrUp = shIrradiance(vec3(0.0, 1.0, 0.0));
    float fillLum = dot(irrUp, vec3(0.2126, 0.7152, 0.0722));
    float fill = max(dot(N, normalize(V + vec3(0.0, 0.55, 0.0))), 0.0);
    float wrap = 0.40 + 0.60 * fill;
    ambient += albedo * fillLum * (0.72 * uViewmodelLight * wrap);
  }

  // aerial perspective is applied to the combined result later; split it here
  float fogAmount = 1.0 - exp(-viewDist * uFogDensity);
  float sunAmount = max(dot(-V, uSunDirection), 0.0);
  vec3 fog = mix(uFogColor, uFogColor * 1.3 + uSunColor * 0.05, pow(sunAmount, 6.0));
  direct = mix(direct, vec3(0.0), clamp(fogAmount, 0.0, 1.0));
  ambient = mix(ambient, fog, clamp(fogAmount, 0.0, 1.0));

  outDirect = vec4(direct, 0.0);
  outAmbient = vec4(ambient, ao);
  outNormal = vec4(octEncode(N), rough, 0.25);

  vec2 curNdc = vCurClip.xy / max(vCurClip.w, 1e-6);
  vec2 prevNdc = vPrevClip.xy / max(vPrevClip.w, 1e-6);
  outVelocity = vec4((curNdc - prevNdc) * 0.5, 0.0, 1.0);
}
`;
