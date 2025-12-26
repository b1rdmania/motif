import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  server: {
    port: 3000,
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
        // Sharing trial pages
        play: resolve(__dirname, 'play.html'),
        ux_test: resolve(__dirname, 'ux-test.html'),
      },
    },
  },
})