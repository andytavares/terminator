import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { extensionViewConfig } from '@terminator/extension-sdk/vite'

export default defineConfig(
  extensionViewConfig(__dirname, { plugins: [react()], chunkSizeWarningLimit: 540 })
)
