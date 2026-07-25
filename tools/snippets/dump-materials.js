// Blit layers out of the generated texture arrays onto a 2D canvas laid over
// the page, so a screenshot shows exactly what the material generator produced
// rather than what survives lighting and tiling in the world shader.
//
// This talks to raw WebGL2 rather than three. Exposing the three namespace on
// the harness so a dev snippet could build a quad defeats tree-shaking and puts
// 230kB of dead library into the shipped bundle, which is not a trade worth
// making for a debugging tool.
const lib = g.materialLibrary;
const layers = [0, 1, 2, 3, 5, 18];
const maps = [
  ['albedo', lib.albedo, 1],
  ['normal', lib.normal, 0],
  ['orm', lib.orm, 0]
];
const S = 256;
const gl = g.renderer.getContext();

const compile = (type, src) => {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
};
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es
  out vec2 vUv;
  void main(){
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `#version 300 es
  precision highp float; precision highp sampler2DArray;
  uniform sampler2DArray uTex; uniform float uLayer; uniform float uSrgb;
  in vec2 vUv; out vec4 o;
  void main(){
    vec3 t = texture(uTex, vec3(vUv, uLayer)).rgb;
    if(uSrgb > 0.5) t = pow(max(t, 0.0), vec3(1.0/2.2));
    o = vec4(t, 1.0);
  }`));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, S, S);
const fbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.useProgram(prog);
gl.viewport(0, 0, S, S);
gl.disable(gl.DEPTH_TEST);
gl.disable(gl.BLEND);

const out = document.createElement('canvas');
out.width = maps.length * S;
out.height = layers.length * S;
const ctx = out.getContext('2d');
const buf = new Uint8Array(S * S * 4);
const img = ctx.createImageData(S, S);

for (let r = 0; r < layers.length; r++) {
  for (let c = 0; c < maps.length; c++) {
    const [, map, srgb] = maps[c];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.renderer.properties.get(map).__webglTexture);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'uLayer'), layers[r]);
    gl.uniform1f(gl.getUniformLocation(prog, 'uSrgb'), srgb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      img.data.set(buf.subarray(src, src + S * 4), y * S * 4);
    }
    ctx.putImageData(img, c * S, r * S);
  }
}

gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.deleteFramebuffer(fbo);
gl.deleteTexture(tex);
gl.deleteVertexArray(vao);
gl.deleteProgram(prog);
g.renderer.resetState();

ctx.fillStyle = '#0f0';
ctx.font = '13px monospace';
for (let r = 0; r < layers.length; r++) ctx.fillText(`layer ${layers[r]}`, 4, r * S + 14);
maps.forEach(([n], c) => ctx.fillText(n, c * S + 4, out.height - 6));

Object.assign(out.style, {
  position: 'fixed', inset: '0', margin: 'auto', zIndex: 99999,
  height: '100vh', width: 'auto', background: '#000'
});
document.body.appendChild(out);
return { size: [out.width, out.height], layers };
