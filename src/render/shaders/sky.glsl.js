import { GLSL_NOISE } from './noise.glsl.js';

/** Single-scattering Rayleigh/Mie atmosphere shared by the sky pass and the SH capture. */
export const GLSL_ATMOSPHERE = /* glsl */`
uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform float uTurbidity;

const float R_EARTH = 6371000.0;
const float R_ATMOS = 6471000.0;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BETA_M = 8.0e-6;
const float H_R = 8000.0;
const float H_M = 1200.0;

float rayleighPhase(float mu){ return 3.0/(16.0*3.14159265) * (1.0 + mu*mu); }
float miePhase(float mu, float g){
  float g2 = g*g;
  return 3.0/(8.0*3.14159265) * ((1.0-g2)*(1.0+mu*mu)) / ((2.0+g2)*pow(1.0+g2-2.0*g*mu, 1.5));
}

float raySphere(vec3 o, vec3 d, float r){
  float b = dot(o, d);
  float c = dot(o, o) - r*r;
  float disc = b*b - c;
  if(disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

vec3 atmosphere(vec3 dir, vec3 sunDir){
  vec3 origin = vec3(0.0, R_EARTH + 220.0, 0.0);
  float d = raySphere(origin, dir, R_ATMOS);
  if(d < 0.0) return vec3(0.0);

  const int STEPS = 12;
  const int LIGHT_STEPS = 4;
  float segment = d / float(STEPS);
  float mu = dot(dir, sunDir);
  float pr = rayleighPhase(mu);
  float pm = miePhase(mu, 0.76);

  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float mieScale = BETA_M * (0.7 + uTurbidity * 0.55);

  for(int i=0;i<STEPS;i++){
    vec3 p = origin + dir * (segment * (float(i) + 0.5));
    float h = length(p) - R_EARTH;
    float hr = exp(-h/H_R) * segment;
    float hm = exp(-h/H_M) * segment;
    odR += hr; odM += hm;

    float dl = raySphere(p, sunDir, R_ATMOS);
    float lSeg = dl / float(LIGHT_STEPS);
    float odLR = 0.0, odLM = 0.0;
    bool blocked = false;
    for(int j=0;j<LIGHT_STEPS;j++){
      vec3 lp = p + sunDir * (lSeg * (float(j) + 0.5));
      float lh = length(lp) - R_EARTH;
      if(lh < 0.0){ blocked = true; break; }
      odLR += exp(-lh/H_R) * lSeg;
      odLM += exp(-lh/H_M) * lSeg;
    }
    if(blocked) continue;
    vec3 tau = BETA_R * (odR + odLR) + vec3(mieScale * 1.1) * (odM + odLM);
    vec3 att = exp(-tau);
    sumR += hr * att;
    sumM += hm * att;
  }
  // Cheap multiple-scattering approximation: an isotropic-phase contribution
  // proportional to the accumulated scattering. Without it a single-scattering
  // sky reads far too dark and too saturated near the horizon. The Mie share is
  // kept low or the long horizon paths turn the whole band milky yellow.
  vec3 ms = (sumR * BETA_R * 0.8 + sumM * vec3(mieScale) * 0.22) * 0.5 * max(sunDir.y, 0.0);
  return uSunIntensity * (sumR * BETA_R * pr + sumM * mieScale * pm + ms);
}
`;

export const CLOUD_FRAG = /* glsl */`
${GLSL_NOISE}
${GLSL_ATMOSPHERE}

uniform mat4 uInvViewProjection;
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uCoverage;
uniform int uSteps;
uniform vec3 uSunColor;
uniform vec2 uWind;

in vec2 vUv;
layout(location = 0) out vec4 outColor;

const float CLOUD_BOTTOM = 900.0;
const float CLOUD_TOP = 3200.0;

float cloudShape(vec3 p){
  vec3 q = p * 0.00042;
  q.xz += uWind * uTime * 0.0016;
  float base = fbm3(q, 4, 0.55);
  float detail = fbm3(q * 4.2 + 13.7, 3, 0.5);
  float heightFrac = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
  // cumulus profile: rounded bottom, billowing top, hard-ish anvil cutoff
  float profile = smoothstep(0.0, 0.18, heightFrac) * (1.0 - smoothstep(0.55, 1.0, heightFrac));
  float d = base * profile;
  // A tighter band gives cumulus a defined edge instead of a haze gradient.
  d = smoothstep(uCoverage, uCoverage + 0.20, d);
  d -= detail * 0.20 * (1.0 - heightFrac * 0.6);
  return clamp(d, 0.0, 1.0);
}

void main(){
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 world = uInvViewProjection * ndc;
  vec3 dir = normalize(world.xyz / world.w - uCameraPos);

  if(dir.y < 0.004){ outColor = vec4(0.0); return; }

  vec3 ro = vec3(uCameraPos.x, max(uCameraPos.y, 1.0), uCameraPos.z);
  float t0 = (CLOUD_BOTTOM - ro.y) / dir.y;
  float t1 = (CLOUD_TOP - ro.y) / dir.y;
  if(t1 < 0.0){ outColor = vec4(0.0); return; }
  t0 = max(t0, 0.0);

  float span = min(t1 - t0, 22000.0);
  int steps = uSteps;
  float dt = span / float(steps);

  float jitter = hash12(gl_FragCoord.xy + fract(uTime) * 37.0);
  float t = t0 + dt * jitter;

  vec3 scattered = vec3(0.0);
  float transmittance = 1.0;
  float mu = dot(dir, uSunDirection);
  float phase = mix(miePhase(mu, 0.62), miePhase(mu, -0.14), 0.35);

  for(int i=0;i<64;i++){
    if(i >= steps || transmittance < 0.02) break;
    vec3 p = ro + dir * t;
    float density = cloudShape(p);
    if(density > 0.001){
      // cheap 3-tap light march toward the sun
      float lightDensity = 0.0;
      for(int j=1;j<=3;j++){
        vec3 lp = p + uSunDirection * (float(j) * 130.0);
        lightDensity += cloudShape(lp) * 130.0;
      }
      float sunTrans = exp(-lightDensity * 0.0022);
      // powder / dark-edge term
      float powder = 1.0 - exp(-density * 6.0);
      // Cloud radiance has to be built from the same scale as the sun that lights
      // the ground, otherwise the deck renders darker than the sky behind it.
      // The constant floor stands in for multiple scattering inside the cloud.
      float lit = sunTrans * (phase * 4.0 + 0.34) * 0.55 + 0.052;
      vec3 lightCol = uSunColor * uSunIntensity * lit * mix(0.62, 1.0, powder);
      lightCol += vec3(0.40, 0.50, 0.72) * 1.15;   // sky bounce into the cloud
      float extinct = exp(-density * dt * 0.0052);
      scattered += transmittance * (1.0 - extinct) * lightCol;
      transmittance *= extinct;
    }
    t += dt;
  }

  // fade the layer out toward the horizon so it never forms a hard band
  float horizonFade = smoothstep(0.004, 0.09, dir.y);
  float alpha = (1.0 - transmittance) * horizonFade;
  outColor = vec4(scattered * horizonFade, alpha);
}
`;

export const SKY_FRAG = /* glsl */`
${GLSL_NOISE}
${GLSL_ATMOSPHERE}

uniform mat4 uInvViewProjection;
uniform mat4 uPrevViewProjection;
uniform vec3 uCameraPos;
uniform sampler2D uClouds;
uniform float uTime;
uniform vec3 uSunColor;

in vec2 vUv;
layout(location = 0) out vec4 outDirect;
layout(location = 1) out vec4 outAmbient;
layout(location = 2) out vec4 outNormal;
layout(location = 3) out vec4 outVelocity;

void main(){
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 world = uInvViewProjection * ndc;
  vec3 dir = normalize(world.xyz / world.w - uCameraPos);

  vec3 sky = atmosphere(dir, uSunDirection);

  // sun disk with limb darkening
  float cosAngle = dot(dir, uSunDirection);
  float sunAngular = 0.9995;
  if(cosAngle > sunAngular){
    float r = sqrt(max(0.0, 1.0 - pow((1.0-cosAngle)/(1.0-sunAngular), 2.0)));
    sky += uSunColor * 92.0 * mix(0.62, 1.0, r);
  }
  sky += uSunColor * pow(max(cosAngle, 0.0), 900.0) * 6.0;

  vec4 clouds = texture(uClouds, vUv);
  sky = sky * (1.0 - clouds.a) + clouds.rgb;

  // ground half-space so looking down past the map edge is not black
  float below = smoothstep(0.02, -0.06, dir.y);
  vec3 groundCol = vec3(0.30, 0.26, 0.20) * (0.35 + max(uSunDirection.y, 0.0) * 0.9);
  sky = mix(sky, groundCol, below);

  outDirect = vec4(sky, 0.0);
  outAmbient = vec4(0.0, 0.0, 0.0, 1.0);
  outNormal = vec4(0.5, 0.5, 1.0, 0.0);

  vec4 prev = uPrevViewProjection * vec4(uCameraPos + dir * 8000.0, 1.0);
  vec2 prevNdc = prev.xy / max(prev.w, 1e-6);
  outVelocity = vec4((ndc.xy - prevNdc) * 0.5, 0.0, 1.0);
}
`;

/** Equirectangular capture used to project sky radiance into SH9 on the CPU. */
export const SKY_CAPTURE_FRAG = /* glsl */`
${GLSL_NOISE}
${GLSL_ATMOSPHERE}

uniform vec3 uSunColor;
uniform float uCloudCoverage;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main(){
  float phi = (vUv.x * 2.0 - 1.0) * 3.14159265;
  float theta = (1.0 - vUv.y) * 3.14159265;
  vec3 dir = vec3(sin(theta)*sin(phi), cos(theta), sin(theta)*cos(phi));
  vec3 c = atmosphere(dir, uSunDirection);
  // Sunlit cumulus are brighter and far less blue than the sky they cover, so
  // the deck lifts and neutralises the upper hemisphere of the irradiance probe.
  // The lift is deliberately modest: a cloud top is a diffuse reflector, not a
  // second sun, and overstating it flattens every shadow in the scene.
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 cloudCol = uSunColor * uSunIntensity * 0.045 + vec3(0.10, 0.13, 0.19);
  c = mix(c, cloudCol, up * uCloudCoverage * 0.45);
  if(dir.y < 0.0){
    c = vec3(0.30, 0.26, 0.20) * (0.35 + max(uSunDirection.y,0.0)*0.9) * 0.6;
  }
  outColor = vec4(c, 1.0);
}
`;
