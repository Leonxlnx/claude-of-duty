const sky = g.graph.sky;
const u = g.graph.lightUniforms;
const lum = (v) => Math.round((v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722) * 1000) / 1000;
const lum3 = (c) => Math.round((c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722) * 1000) / 1000;

// SH band 0 is the average irradiance over the whole sphere.
const sh = u.uSkySH.value;
// Irradiance on an up-facing surface, evaluated from the SH the shader uses.
const evalSH = (nx, ny, nz) => {
  const c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
  const out = { x: 0, y: 0, z: 0 };
  for (const k of ['x', 'y', 'z']) {
    out[k] =
      c4 * sh[0][k] +
      2 * c2 * (sh[3][k] * nx + sh[1][k] * ny + sh[2][k] * nz) +
      2 * c1 * (sh[4][k] * nx * ny + sh[5][k] * ny * nz + sh[7][k] * nx * nz) +
      c3 * sh[6][k] * nz * nz - c5 * sh[6][k] +
      c1 * sh[8][k] * (nx * nx - ny * ny);
  }
  return out;
};

const sd = sky.sunDirection;
const up = evalSH(0, 1, 0);
const side = evalSH(1, 0, 0);
const sun = u.uSunColor.value;

return {
  sunDir: [sd.x, sd.y, sd.z].map((v) => Math.round(v * 100) / 100),
  sunElevationDeg: Math.round(Math.asin(sd.y) * 180 / Math.PI),
  sunIntensity: sky.sunIntensity,
  sunRadiance: lum(sun),
  // Irradiance / pi is the radiance a lambertian surface reflects at albedo 1.
  directOnFlatGround: Math.round(lum(sun) * sd.y * 1000) / 1000,
  ambientUp: Math.round(lum(up) * 1000) / 1000,
  ambientSide: Math.round(lum(side) * 1000) / 1000,
  ratioGround: Math.round((lum(sun) * sd.y) / Math.max(lum(up), 1e-4) * 100) / 100,
  zenith: lum3(sky.zenithColor),
  horizon: lum3(sky.horizonColor),
  ground: lum3(sky.groundColor),
  avgSky: lum3(sky.averageSky),
  exposure: g.graph.compositePass.uniforms.uExposureOverride.value
};
