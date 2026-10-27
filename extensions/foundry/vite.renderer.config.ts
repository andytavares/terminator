import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

// Electron loads from disk, so Vite's 500 kB download heuristic becomes a budget on the
// largest chunk; each view is its own chunk (src/renderer/App.tsx). The entry, with the
// Inbox and TanStack Query, is largest at 373 kB; CI fails on any warning past the budget.
export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 380 })
)
