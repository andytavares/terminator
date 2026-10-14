import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Loaded from disk, so Vite's 500 kB download heuristic gives way to a budget on the largest
// chunk: Excalidraw is one 2,422 kB module, loaded only when a diagram opens. CI fails the build
// on any chunk warning.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 2600 })
)
