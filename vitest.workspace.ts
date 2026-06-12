import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'core',
      include: [
        'tests/unit/**/*.spec.ts',
        'tests/unit/**/*.spec.tsx',
        'tests/unit/**/*.spec.js',
        'tests/integration/**/*.spec.ts',
        'tests/integration/**/*.spec.js',
        'extensions/git-integration/tests/**/*.spec.ts',
        'extensions/git-integration/tests/**/*.spec.tsx',
        'extensions/git-integration/tests/**/*.spec.js',
        'src/main/remote/__tests__/**/*.spec.ts',
        'src/main/ipc/__tests__/**/*.spec.ts',
      ],
      exclude: ['extensions/speckit-pilot/**'],
    },
  },
  {
    test: {
      name: 'speckit-pilot',
      include: [
        'extensions/speckit-pilot/tests/**/*.spec.ts',
        'extensions/speckit-pilot/tests/**/*.spec.tsx',
        'extensions/speckit-pilot/tests/**/*.spec.js',
      ],
      environment: 'node',
      environmentMatchGlobs: [['extensions/speckit-pilot/tests/components/**/*.spec.tsx', 'jsdom']],
      globals: true,
      setupFiles: ['tests/setup.ts'],
    },
  },
])
