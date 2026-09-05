import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// React is a peer dependency, never bundled: every extension ships its own copy
// and a dialog renders inside the caller's own React tree (ADR 038).
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    cssFileName: 'extension-ui',
    emptyOutDir: true,
  },
})
