import { GLSL_NOISE } from './noise.glsl.js';

/**
 * One instanced billboard shader covers every loose element in the world:
 * dust, smoke, sparks, blood, tracers and muzzle flash. The kind attribute
 * picks the profile; the geometry is a unit quad stretched along velocity when
 * the element is a streak.
 */

export const PARTICLE_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;

in vec3 iPosition;
in vec3 iVelocity;
in vec4 iParams;     // x size, y rotation, z stretch, w kind
in vec4 iColor;      // rgb tint, a opacity

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCameraPos;
uniform vec4 uJitter;

out vec2 vUv;
out vec4 vColor;
out float vKind;
out vec3 vWorldPos;
out float vSeed;
out float vStretch;

void main(){
  vec3 toCam = uCameraPos - iPosition;
  vec3 fwd = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  if(dot(right, right) < 0.5) right = vec3(1.0, 0.0, 0.0);
  vec3 up = cross(fwd, right);

  float size = iParams.x;
  float rot = iParams.y;
  float stretch = iParams.z;

  vec2 q = position.xy;
  if(stretch > 0.001){
    // align the quad with the velocity vector projected into the billboard plane
    vec3 v = iVelocity;
    float vl = length(v);
    if(vl > 0.0001){
      vec3 vd = v / vl;
      vec3 sr = normalize(cross(fwd, vd));
      vec3 su = cross(sr, fwd);
      right = sr;
      up = su;
    }
    vec3 offset = right * (q.x * size) + up * (q.y * size * (1.0 + stretch));
    vWorldPos = iPosition + offset;
  } else {
    float c = cos(rot), s = sin(rot);
    vec2 r2 = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    vWorldPos = iPosition + right * (r2.x * size) + up * (r2.y * size);
  }

  vUv = uv;
  vColor = iColor;
  vKind = iParams.w;
  vStretch = stretch;
  vSeed = fract(iPosition.x * 0.731 + iPosition.z * 0.517 + iParams.y * 0.113);

  vec4 clip = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  clip.xy += uJitter.xy * clip.w;
  gl_Position = clip;
}
`;

export const PARTICLE_FRAG = /* glsl */`
precision highp float;
${GLSL_NOISE}

uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uAmbient;
uniform float uTime;

in vec2 vUv;
in vec4 vColor;
in float vKind;
in vec3 vWorldPos;
in float vSeed;
in float vStretch;

layout(location = 0) out vec4 outColor;

// 0 dust  1 smoke  2 spark  3 blood  4 tracer  5 flash  6 debris
void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  int kind = int(vKind + 0.5);

  vec3 col = vColor.rgb;
  float alpha = vColor.a;

  if(kind == 0 || kind == 1){
    // billowing puff: radial falloff broken up with rotating value noise
    float n = fbm(c * 1.7 + vec2(vSeed * 31.0, uTime * 0.25), 4, 0.55);
    float edge = r + (n - 0.5) * 0.85;
    float mask = 1.0 - smoothstep(0.35, 1.0, edge);
    if(mask <= 0.002) discard;
    // cheap self-shading: the side facing the sun is brighter
    float lift = clamp(0.45 + 0.55 * (0.5 - c.y), 0.0, 1.0);
    vec3 lit = uAmbient * 0.85 + uSunColor * 0.055 * lift;
    col *= lit;
    alpha *= mask * (kind == 1 ? 0.85 : 1.0);
  } else if(kind == 2){
    // spark: hot core along the streak axis, cooling toward the tail
    float axial = abs(c.x);
    float along = c.y * 0.5 + 0.5;
    float mask = (1.0 - smoothstep(0.0, 0.75, axial)) * (1.0 - smoothstep(0.25, 1.0, abs(c.y)));
    if(mask <= 0.002) discard;
    vec3 hot = mix(vec3(1.0, 0.45, 0.10), vec3(1.0, 0.95, 0.72), pow(along, 2.0));
    col = hot * (2.0 + 22.0 * pow(mask, 3.0));
    alpha = mask * vColor.a;
  } else if(kind == 3){
    float n = fbm(c * 2.6 + vSeed * 17.0, 3, 0.6);
    float mask = 1.0 - smoothstep(0.4, 1.0, r + (n - 0.5) * 0.7);
    if(mask <= 0.002) discard;
    col *= uAmbient * 1.1 + uSunColor * 0.02;
    alpha *= mask;
  } else if(kind == 4){
    // tracer: thin bright rod with a soft halo, brighter at the head
    float axial = abs(c.x);
    float core = 1.0 - smoothstep(0.0, 0.30, axial);
    float halo = 1.0 - smoothstep(0.0, 1.0, axial);
    float head = smoothstep(-1.0, 1.0, c.y);
    float mask = core + halo * 0.22;
    if(mask <= 0.002) discard;
    col = vColor.rgb * (1.5 + 12.0 * core) * mix(0.35, 1.0, head);
    alpha = clamp(mask, 0.0, 1.0) * vColor.a;
  } else if(kind == 5){
    // muzzle flash: four-point star plus a hot centre
    float star = max(1.0 - smoothstep(0.0, 0.16, abs(c.x)), 1.0 - smoothstep(0.0, 0.16, abs(c.y)));
    star *= 1.0 - smoothstep(0.2, 1.0, r);
    float core = 1.0 - smoothstep(0.0, 0.45, r);
    float petal = 1.0 - smoothstep(0.0, 0.9, r + (hash12(vec2(atan(c.y, c.x) * 3.0, vSeed)) - 0.5) * 0.5);
    float mask = clamp(core * 1.4 + star * 0.7 + petal * 0.35, 0.0, 3.0);
    if(mask <= 0.004) discard;
    col = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.94, 0.78), core) * mask * 26.0;
    alpha = clamp(mask, 0.0, 1.0) * vColor.a;
  } else {
    // debris chip: hard-edged, lit like a solid
    float mask = 1.0 - step(0.86, max(abs(c.x), abs(c.y)));
    if(mask <= 0.002) discard;
    col *= uAmbient + uSunColor * 0.05;
    alpha *= mask;
  }

  outColor = vec4(col * alpha, alpha);
}
`;
