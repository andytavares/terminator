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

// happy-dom, not jsdom: jsdom validates every CSS declaration CodeMirror and the
// design system inject, which timed specs out (docs/CONTRIBUTING.md, "Run tests").
const HAPPY_DOM_INCLUDE = [
  'extensions/notepad/tests/**/*.spec.tsx',
  'extensions/git-integration/tests/**/*.spec.tsx',
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
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Vitest turns every stylesheet into an empty string, `?raw` imports included.
    // The design system's token file is read as text, so those keep their content.
    css: { include: [/\.css\?raw$/] },
    // Electron 42 downloads its binary on the first require('electron'), which
    // specs reach through externalised dependencies vi.mock cannot intercept.
    // No unit test runs the binary; the override makes the require a path join.
    env: {
      ELECTRON_OVERRIDE_DIST_PATH: resolve(__dirname, 'node_modules/electron/dist'),
    },
    // Task Vault's backend uses Temporal (ADR 108). Electron 44 has it; Node 24
    // only behind this flag. Remove it when .nvmrc reaches Node 26, which ships it.
    execArgv: ['--harmony-temporal'],
    // At the default (one worker per core, 16 here) the real-git specs starve and hit the 5 s
    // timeout, a different few on each run; 8 workers pass every run for 6 s more wall time.
    maxWorkers: 8,
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
            // Wall-clock budgets run alone, in `npm run test:perf`
            // (vitest.perf.config.ts): beside every other spec they measure the load.
            '**/*.perf.spec.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: JSDOM_INCLUDE,
          exclude: [...configDefaults.exclude, ...HAPPY_DOM_INCLUDE],
        },
      },
      {
        extends: true,
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          include: HAPPY_DOM_INCLUDE,
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
        'vitest.perf.config.ts',
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
        'extensions/*/src/vault/types.ts',
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
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
