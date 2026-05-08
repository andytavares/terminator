import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.spec.ts',
      'tests/unit/**/*.spec.js',
      'tests/integration/**/*.spec.ts',
      'tests/integration/**/*.spec.js',
      'extensions/*/tests/**/*.spec.ts',
      'extensions/*/tests/**/*.spec.js',
    ],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/renderer/index.tsx', 'src/main/index.ts', 'src/main/preload.ts'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
