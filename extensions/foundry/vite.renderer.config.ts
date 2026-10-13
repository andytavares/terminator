import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Loaded from disk by Electron, so Vite's 500 kB default (a download-size
// heuristic) is replaced by a budget on the largest chunk. Each view (Orders,
// the factory site and hall, the Ledger, settings) is its own chunk
// (src/renderer/App.tsx); the largest is the entry with the Inbox, at 332 kB.
// A chunk past the budget warns, and CI fails the build on any warning.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 340 })
)
