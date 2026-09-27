import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/preload.ts'),
          webview: resolve(__dirname, 'src/main/preload-webview.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    build: {
      // Loaded from disk by Electron, so Vite's 500 kB default (a download-size
      // heuristic) is replaced by a budget on the largest chunk: the app shell
      // is 1,643 kB, unminified as electron-vite builds renderers. A chunk past
      // it warns, and CI fails the build on any warning.
      chunkSizeWarningLimit: 1800,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
