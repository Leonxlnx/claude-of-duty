import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Stamped into the start screen. A browser tab that has been open across a
  // fix keeps serving the old module graph, and "have you reloaded" is not a
  // question anybody can answer honestly from memory — this makes it readable.
  define: { __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: {
    target: 'es2022',
    // Everything is inlined into one script and one sheet on purpose: the
    // build has to run from a file:// directory with no server behind it.
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
        assetFileNames: 'game.[ext]'
      }
    }
  },
  server: { port: 5173, strictPort: true }
});
