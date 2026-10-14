import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Electron loads from disk, so Vite's 500 kB download heuristic becomes a budget on the
// largest chunk; each view is its own chunk (src/renderer/App.tsx), the entry with the
// Inbox largest at 332 kB. Past the budget it warns, and CI fails on any warning.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 340 })
)
