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
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/**/*.ts',
        'src/**/*.tsx',
        'extensions/*/src/**/*.ts',
        'extensions/*/src/**/*.tsx',
      ],
      exclude: [
        'src/renderer/index.tsx',
        'src/main/index.ts',
        'src/main/preload.ts',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/tests/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
