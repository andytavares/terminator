import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Loaded from disk by Electron, so Vite's 500 kB default (a download-size
// heuristic) is replaced by a budget on the largest chunk: Excalidraw is
// one 2,422 kB module, already loaded only when a diagram opens. A chunk
// past it warns, and CI fails the build on any warning.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 2600 })
)
