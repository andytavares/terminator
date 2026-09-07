/* v8 ignore file */
import { defineConfig, configDefaults } from 'vitest/config'
import { resolve } from 'path'

// Tests that require a DOM. vitest 4 removed `environmentMatchGlobs`, so the
// node/jsdom split is expressed as two projects instead.
const JSDOM_INCLUDE = [
  'tests/unit/**/*.spec.tsx',
  'packages/*/tests/**/*.spec.tsx',
  'tests/unit/renderer-remote/**/*.spec.ts',
  'extensions/*/tests/**/*.spec.tsx',
]

const NODE_INCLUDE = [
  'tests/unit/**/*.spec.ts',
  'tests/unit/**/*.spec.js',
  'packages/*/tests/**/*.spec.ts',
  'tests/integration/**/*.spec.ts',
  'tests/integration/**/*.spec.js',
  'extensions/*/tests/**/*.spec.ts',
  'extensions/*/tests/**/*.spec.js',
  'src/main/remote/__tests__/**/*.spec.ts',
  'src/main/ipc/__tests__/**/*.spec.ts',
  'src/shared/**/__tests__/**/*.spec.ts',
]

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: NODE_INCLUDE,
          exclude: [
            ...configDefaults.exclude,
            // `.ts` specs under renderer-remote need the DOM — run them in the
            // jsdom project instead.
            'tests/unit/renderer-remote/**/*.spec.ts',
            // Live specs talk to a real remote and need `gh` authenticated.
            // Run deliberately: `npm run test:live`. Left in the default run
            // they would report "skipped", and a skip in a green suite is a
            // check nobody notices is missing.
            'extensions/*/tests/live/**',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: JSDOM_INCLUDE,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/**/*.ts',
        'src/**/*.tsx',
        'extensions/*/src/**/*.ts',
        'extensions/*/src/**/*.tsx',
        'packages/extension-ui/src/**/*.ts',
        'packages/extension-ui/src/**/*.tsx',
        'vite.config.remote.ts',
      ],
      exclude: [
        'vitest.config.ts',
        'vitest.live.config.ts',
        'playwright.config.ts',
        'packages/*/vite.config.ts',
        'src/renderer/index.tsx',
        'src/renderer-remote/mobile.main.tsx',
        'src/main/index.ts',
        'src/main/preload.ts',
        'extensions/*/src/index.ts',
        'extensions/*/src/renderer.tsx',
        'extensions/*/src/stores/**',
        'extensions/*/src/components/**',
        'extensions/*/src/mcp/server.ts',
        'extensions/*/src/vault/types.ts',
        'extensions/*/src/vault/writer.ts',
        'extensions/*/src/schemas/project.schema.ts',
        'extensions/*/src/types/**',
        'extensions/*/src/providers/adapter.ts',
        'src/shared/types/**',
        '**/*.d.ts',
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
