import { chromium } from '@playwright/test';

/**
 * Time a real boot on the hardware GPU path.
 *   node tools/bootcost.mjs [query]
 *
 * The headless SwiftShader path used by the test suite compiles anything
 * quickly and hides driver shader-compiler behaviour completely, so boot cost
 * has to be measured through ANGLE on D3D11 like a player would get.
 */
const query = process.argv[2] ?? '';
const port = process.env.PORT || 5173;

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
let ready = true;
try {
  await page.waitForFunction(() => window.__ready === true, { timeout: 180000 });
} catch {
  ready = false;
}

const info = await page.evaluate(() => ({
  matgen: {
    compileMs: window.__game?.materialLibrary?.compileMs,
    drawMs: window.__game?.materialLibrary?.drawMs
  },
  boot: window.__game?.bootTimings ?? null,
  failed: document.getElementById('ui-root')?.innerText?.slice(0, 160) ?? '',
  renderer: (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
    } catch (e) { return String(e); }
  })()
}));

console.log(JSON.stringify({ ready, totalMs: Date.now() - t0, ...info }, null, 2));
await browser.close();
