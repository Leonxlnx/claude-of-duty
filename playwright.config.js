import { defineConfig, devices } from '@playwright/test';

/**
 * The suite runs against a production build served by `vite preview`, so the
 * numbers it reports are the numbers a player would get. Chromium is launched
 * with the ANGLE/GL backend because the default SwiftShader path cannot render
 * a WebGL2 MRT pipeline at any useful speed.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html' }]],
  outputDir: 'test-results/artifacts',

  use: {
    baseURL: 'http://localhost:4319',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=gl',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--disable-frame-rate-limit',
        '--autoplay-policy=no-user-gesture-required'
      ]
    }
  },

  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4319',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000
  }
});
