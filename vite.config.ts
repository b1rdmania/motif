import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '^/s/[^/]+$': { target: 'http://localhost:3001', rewrite: (path) => path },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // Existing pages (keep for backward compatibility)
        embed: resolve(__dirname, 'embed.html'),
        models: resolve(__dirname, 'models.html'),
        // Share link landing page
        play: resolve(__dirname, 'play.html'),
        // V2 authentic Game Boy engine (experimental, unlinked from the main
        // app — shipped so people can try it from the open issue).
        v2: resolve(__dirname, 'v2.html'),
        // Note: internal test/diagnostic pages (ux-test, v2-test,
        // v2-diagnostic) stay out of the production build. The .html files
        // remain in the repo for local development; add them back to ship.
      },
    },
  },
})