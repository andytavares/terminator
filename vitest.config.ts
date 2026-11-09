import { defineConfig, configDefaults } from 'vitest/config'
import { availableParallelism, totalmem } from 'node:os'
import { resolve } from 'path'
import { HANG_BOUND_MS, WAIT_BOUND_MS } from './packages/test-support/src/bounds'
import { unitWorkers } from './packages/test-support/src/workers'

// Tests that require a DOM. vitest 4 removed `environmentMatchGlobs`, so the
// node/jsdom split is expressed as two projects instead.
const JSDOM_INCLUDE = [
  'tests/unit/**/*.spec.tsx',
  'packages/*/tests/**/*.spec.tsx',
  'packages/core-renderer-remote/tests/unit/**/*.spec.ts',
  'extensions/*/tests/**/*.spec.tsx',
]

// One boundary the code owns, through a private instance: real git, child processes, files,
// sockets on loopback, a database each test makes. A unit spec does none of that (T-TIER).
const INTEGRATION_INCLUDE = [
  'tests/integration/**/*.spec.{ts,tsx,js}',
  'packages/*/tests/integration/**/*.spec.{ts,tsx,js}',
  'extensions/*/tests/integration/**/*.spec.{ts,tsx,js}',
  'apps/*/tests/integration/**/*.spec.{ts,tsx,js}',
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
  'extensions/*/tests/**/*.spec.ts',
  'extensions/*/tests/**/*.spec.js',
  'apps/*/tests/**/*.spec.{ts,tsx}',
  'packages/core-main/src/remote/__tests__/**/*.spec.ts',
  'packages/core-main/src/ipc/__tests__/**/*.spec.ts',
  'packages/core-shared/src/**/__tests__/**/*.spec.ts',
]

// `npm run test:root` runs only the root's own specs (tests/): every workspace runs its own.
// The lint rules' specs are their own cached task, `npm run test:lint-rules`.
const OTHER_WORKSPACES =
  process.env.TERMINATOR_TESTS === 'root'
    ? ['packages/**', 'extensions/**', 'apps/**', 'tests/integration/lint/**']
    : []

export default defineConfig({
  test: {
    globals: true,
    // Each test starts with its mocks reset, calls and implementations alike: a test that reads a
    // mock another test or a beforeAll set up depends on the order (T-CLEAN-SLATE).
    mockReset: true,
    globalSetup: ['packages/test-support/global-setup.ts'],
    setupFiles: ['packages/test-support/setup.ts'],
    // Vitest turns every stylesheet into an empty string, `?raw` imports included.
    // The design system's token file is read as text, so those keep their content.
    css: { include: [/\.css\?raw$/] },
    // Task Vault's backend uses Temporal (ADR 108). Electron 44 has it; Node 24
    // only behind this flag. Remove it when .nvmrc reaches Node 26, which ships it.
    execArgv: ['--harmony-temporal'],
    // One bound per test and hook, there only to catch a hang: far above any real duration, so
    // a slower machine never changes a result (ADR 123). Specs may not set their own.
    testTimeout: HANG_BOUND_MS,
    hookTimeout: HANG_BOUND_MS,
    expect: { poll: { timeout: WAIT_BOUND_MS } },
    // One rule here and on CI: a core each, as memory allows (packages/test-support/src/workers.ts). A spec that
    // fails with more workers has a timing dependency to fix, not a count to lower (ADR 123).
    maxWorkers: unitWorkers({ cores: availableParallelism(), memory: totalmem() }),
    // A spy, a stubbed variable or a stubbed global does not outlive its test.
    // Files and the tests inside them run in a new random order every run (ADR 123): a test that
    // needs another to have run first fails on some run. Vitest prints the seed; rerun with --sequence.seed.
    sequence: { shuffle: { files: true, tests: true } },
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          provide: { testTier: 'unit' },
          environment: 'node',
          include: NODE_INCLUDE,
          exclude: [
            ...OTHER_WORKSPACES,
            ...configDefaults.exclude,
            ...INTEGRATION_INCLUDE,
            // `.ts` specs under renderer-remote need the DOM — run them in the
            // jsdom project instead.
            'packages/core-renderer-remote/tests/unit/**/*.spec.ts',
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
          provide: { testTier: 'unit' },
          environment: 'jsdom',
          include: JSDOM_INCLUDE,
          exclude: [
            ...OTHER_WORKSPACES,
            ...configDefaults.exclude,
            ...HAPPY_DOM_INCLUDE,
            ...INTEGRATION_INCLUDE,
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'happy-dom',
          provide: { testTier: 'unit' },
          environment: 'happy-dom',
          include: HAPPY_DOM_INCLUDE,
          exclude: [...OTHER_WORKSPACES, ...configDefaults.exclude, ...INTEGRATION_INCLUDE],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          provide: { testTier: 'integration' },
          environment: 'node',
          include: INTEGRATION_INCLUDE,
          exclude: [...configDefaults.exclude, ...OTHER_WORKSPACES],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'packages/core-*/src/**/*.ts',
        'packages/core-*/src/**/*.tsx',
        'packages/core-renderer/extension-frame/**/*.ts',
        'apps/*/src/**/*.ts',
        'apps/*/src/**/*.tsx',
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
        'packages/core-renderer/src/index.tsx',
        'packages/core-renderer-remote/src/mobile.main.tsx',
        'packages/core-main/src/index.ts',
        'packages/core-main/src/preload.ts',
        'extensions/*/src/index.ts',
        'extensions/*/src/renderer.tsx',
        'extensions/*/src/stores/**',
        'extensions/*/src/components/**',
        'extensions/*/src/vault/types.ts',
        'extensions/*/src/types/**',
        'extensions/*/src/providers/adapter.ts',
        'packages/core-shared/src/types/**',
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
      '@shared': resolve(__dirname, 'packages/core-shared/src'),
    },
  },
})
