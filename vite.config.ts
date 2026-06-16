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
        // Note: internal dev/diagnostic pages (ux-test, v2, v2-test,
        // v2-diagnostic) are intentionally excluded from the production build.
        // The .html files remain in the repo for local development; add them
        // back here to ship them.
      },
    },
  },
})