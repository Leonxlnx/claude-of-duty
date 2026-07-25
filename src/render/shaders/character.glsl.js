import { GLSL_NOISE, GLSL_PACK } from './noise.glsl.js';
import { GLSL_LIGHTING } from './world.glsl.js';

/**
 * Rigid-bound character shader. One bone per vertex is all a clothed, armoured
 * soldier needs at gameplay distance — overlapping shoulder, elbow and knee
 * caps hide the joints — and it keeps the whole body to a single draw call
 * with an exact previous-frame pose for motion vectors.
 */

export const CHARACTER_VERT = /* glsl */`
precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;
in float aLayer;
in vec3 aTint;
in float aWear;
in float aBone;

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uBones[16];
uniform mat4 uPrevBones[16];
uniform mat4 uPrevViewProjection;
uniform vec4 uJitter;
uniform float uHitFlash;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out float vLayer;
out vec3 vTint;
out float vWear;
out vec4 vCurClip;
out vec4 vPrevClip;

void main(){
  int b = int(aBone + 0.5);
  mat4 bone = uBones[b];
  vec4 wp = bone * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(bone) * normal);
  vUv = uv;
  vLayer = aLayer;
  vTint = aTint;
  vWear = aWear;

  vec4 clip = projectionMatrix * viewMatrix * wp;
  vCurClip = clip;
  vPrevClip = uPrevViewProjection * uPrevBones[b] * vec4(position, 1.0);

  clip.xy += uJitter.xy * clip.w;
  gl_Position = clip;
}
`;

export const CHARACTER_FRAG = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2DArray;

${GLSL_NOISE}
${GLSL_LIGHTING}

uniform sampler2DArray uAlbedoArray;
uniform sampler2DArray uNormalArray;
uniform sampler2DArray uOrmArray;
uniform mat4 viewMatrix;
uniform float uDetailStrength;
uniform float uHitFlash;

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

vec3 perturbNormal(vec3 N, vec3 V, vec2 texcoord, vec3 mapN){
  vec3 q0 = dFdx(-V);
  vec3 q1 = dFdy(-V);
  vec2 st0 = dFdx(texcoord);
  vec2 st1 = dFdy(texcoord);
  vec3 T = normalize(q0 * st1.y - q1 * st0.y);
  if(any(isnan(T))) return N;
  T = normalize(T - N * dot(N, T));
  vec3 B = cross(N, T);
  return normalize(mat3(T, B, N) * mapN);
}

void main(){
  vec3 V = normalize(uCameraPos - vWorldPos);
  float viewDist = distance(uCameraPos, vWorldPos);

  vec4 alb = texture(uAlbedoArray, vec3(vUv, vLayer));
  vec3 orm = texture(uOrmArray, vec3(vUv, vLayer)).rgb;
  vec3 nrmTex = texture(uNormalArray, vec3(vUv, vLayer)).xyz;

  vec3 albedo = alb.rgb * vTint;
  // field wear: dust settles low on the body and on upward-facing gear
  float up = clamp(vNormal.y, 0.0, 1.0);
  float dust = up * up * (0.3 + vWear * 0.5);
  albedo = mix(albedo, vec3(0.255, 0.192, 0.108), clamp(dust * 0.24, 0.0, 0.32));

  float rough = clamp(orm.g * (0.92 + vWear * 0.2), 0.06, 1.0);
  float metal = orm.b;

  vec3 mapN = nrmTex * 2.0 - 1.0;
  mapN.xy *= uDetailStrength * mix(1.0, 0.3, clamp(viewDist / 34.0, 0.0, 1.0));
  vec3 N = perturbNormal(normalize(vNormal), V, vUv, normalize(mapN));

  float viewDepth = -(viewMatrix * vec4(vWorldPos, 1.0)).z;
  SurfaceOut s = shadeSurface(vWorldPos, N, V, albedo, rough, metal, orm.r, viewDepth, 1.0, 0.0);

  vec3 direct = s.direct;
  vec3 ambient = s.ambient;
  // brief bright wash when a round lands, so hits read even in shadow
  direct += albedo * uHitFlash * 6.0;

  float fogAmount = 1.0 - exp(-viewDist * uFogDensity);
  direct = mix(direct, vec3(0.0), fogAmount);
  ambient = mix(ambient, uFogColor, fogAmount);

  outDirect = vec4(direct, 0.0);
  outAmbient = vec4(ambient, orm.r);
  outNormal = vec4(octEncode(N), rough, 0.25);

  vec2 curNdc = vCurClip.xy / max(vCurClip.w, 1e-6);
  vec2 prevNdc = vPrevClip.xy / max(vPrevClip.w, 1e-6);
  outVelocity = vec4((curNdc - prevNdc) * 0.5, 0.0, 1.0);
}
`;

export const GLSL_CHARACTER_PACK = GLSL_PACK;
