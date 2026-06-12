import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer-remote'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/renderer-remote'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer-remote/index.html'),
        shim: resolve(__dirname, 'src/renderer-remote/electron-api-shim.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'shim' ? 'remote-shim.js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
