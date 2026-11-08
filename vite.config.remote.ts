import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(import.meta.dirname, 'packages/core-renderer-remote/src'),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'out/renderer-remote'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'packages/core-renderer-remote/src/index.html'),
        mobile: resolve(import.meta.dirname, 'packages/core-renderer-remote/src/mobile.html'),
        shim: resolve(
          import.meta.dirname,
          'packages/core-renderer-remote/src/electron-api-shim.ts'
        ),
        frameShim: resolve(
          import.meta.dirname,
          'packages/core-renderer/extension-frame/frame-shim.ts'
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'shim'
            ? 'remote-shim.js'
            : chunk.name === 'frameShim'
              ? 'frame-shim.js'
              : 'assets/[name]-[hash].js',
      },
    },
  },
})
