import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // The SDK and the design system are source-only TypeScript (and CSS, `?raw`),
    // so they are bundled instead of left to be required from node_modules.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@terminator/extension-sdk', '@terminator/extension-ui'],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The extension host, a utilityProcess main starts (ADR 094).
          'extension-host': resolve(__dirname, 'src/main/extensions/host/entry.ts'),
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
      // electron-vite leaves renderers unminified by default; parsing less on
      // every window open is the point, so the renderer is minified.
      minify: 'esbuild',
      // Loaded from disk by Electron, so Vite's 500 kB default (a download-size
      // heuristic) is replaced by a budget on the largest chunk: the app shell
      // is 851 kB. A chunk past it warns, and CI fails the build on any warning.
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
