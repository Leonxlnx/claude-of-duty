/**
 * Collimated red-dot optic.
 *
 * A real reflex sight projects its reticle to infinity: the dot sits where the
 * sight axis points, independent of where the eye is behind the glass. So the
 * shader does not draw a sprite at a fixed spot on the lens — it measures the
 * angle between the eye ray through this fragment and the sight's optical axis
 * and lights the fragment when that angle is inside the reticle's angular size.
 * Parallax-free, and it drifts across the window exactly like the real thing.
 */

export const RETICLE_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec4 uJitter;
out vec3 vWorldPos;
out vec2 vUv;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vUv = uv;
  vec4 clip = projectionMatrix * viewMatrix * wp;
  gl_Position = clip;
}
`;

export const RETICLE_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSightOrigin;
uniform vec3 uSightAxis;
uniform vec3 uSightRight;
uniform vec3 uSightUp;
uniform vec3 uCameraPos;
uniform vec3 uColor;
uniform float uBrightness;
uniform float uDotAngle;
uniform float uWindowRadius;
in vec3 vWorldPos;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main(){
  // circular window with a soft edge; outside it the emitter is masked by the tube
  vec2 c = vUv * 2.0 - 1.0;
  float rWin = length(c);
  if(rWin > 1.0) discard;
  float windowMask = 1.0 - smoothstep(0.86, 1.0, rWin);

  vec3 ray = normalize(vWorldPos - uCameraPos);
  // angular offset of this eye ray from the optical axis, split into the
  // sight's own right/up basis so the reticle can be non-radial if wanted
  float ax = dot(ray, uSightRight);
  float ay = dot(ray, uSightUp);
  float az = max(dot(ray, uSightAxis), 1e-4);
  vec2 ang = vec2(ax, ay) / az;
  float a = length(ang);

  // A crisp core with a short falloff, plus the small amount of scatter a real
  // emitter throws into the coating. The halo is kept deliberately weak: an
  // over-generous glow plus bloom turns a 3 MOA dot into a fist-sized smear
  // that covers the target it is supposed to help you hit.
  float dot1 = 1.0 - smoothstep(uDotAngle * 0.70, uDotAngle * 1.45, a);
  float glow = exp(-a / (uDotAngle * 1.7)) * 0.20;
  float halo = exp(-a / (uDotAngle * 6.0)) * 0.025;

  float intensity = (dot1 + glow + halo) * uBrightness * windowMask;
  if(intensity < 0.002) discard;

  // the emitter is a genuinely bright LED; let it drive a little bloom
  vec3 col = uColor * intensity * 9.0;
  outColor = vec4(col, 1.0);
}
`;

export const GLASS_FRAG = /* glsl */`
precision highp float;
uniform vec3 uCameraPos;
uniform vec3 uSightAxis;
uniform vec3 uSightOrigin;
uniform vec3 uTint;
uniform float uWindowRadius;
in vec3 vWorldPos;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if(r > 1.0) discard;

  vec3 ray = normalize(vWorldPos - uCameraPos);
  float grazing = 1.0 - abs(dot(ray, uSightAxis));

  // dielectric coating: blue-green off-axis reflection, near-clear on axis
  float coat = pow(clamp(grazing, 0.0, 1.0), 1.6);
  float edge = smoothstep(0.72, 1.0, r);

  vec3 tint = uTint * (0.35 + coat * 1.5);
  float alpha = clamp(0.10 + coat * 0.55 + edge * 0.45, 0.0, 0.92);

  // faint concentric wipe marks so the lens is not perfectly clean
  float smudge = sin(r * 28.0 + c.x * 6.0) * 0.5 + 0.5;
  tint += vec3(0.05) * smudge * coat;

  outColor = vec4(tint, alpha);
}
`;
