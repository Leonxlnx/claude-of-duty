import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
