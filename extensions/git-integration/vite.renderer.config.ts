import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
  build: {
    // Loaded from disk by Electron, so Vite's 500 kB default (a download-size
    // heuristic) is replaced by a budget on the largest chunk: the whole review
    // UI, CodeMirror included, is 1,110 kB. A chunk past it warns, and CI fails
    // the build on any warning.
    chunkSizeWarningLimit: 1200,
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
})
