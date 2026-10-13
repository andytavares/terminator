import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Loaded from disk, so Vite's 500 kB download heuristic gives way to a budget on the largest chunk:
// each view is its own chunk (src/renderer/App.tsx), the largest, shared code with CodeMirror and
// highlight.js, is 771 kB. CI fails the build on any chunk warning.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 850 })
)
