import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Loaded from disk by Electron, so Vite's 500 kB default (a download-size
// heuristic) is replaced by a budget on the largest chunk. Each view is its
// own chunk (src/renderer/App.tsx); the largest, the code the Git and review
// views share with CodeMirror and highlight.js, is 771 kB. A chunk past the
// budget warns, and CI fails the build on any warning.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 850 })
)
