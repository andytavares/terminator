import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // `tools/` holds specs that write into the repository — screenshot capture
  // for the user guide. They are run deliberately, never as part of the suite,
  // because a CI run that rewrites a committed file leaves a dirty tree. Set
  // `E2E_TOOLS=1` to include them.
  // `live/` holds specs that launch real agents against a real remote. They
  // cost time and quota and are inherently non-deterministic, so they are run
  // deliberately: `E2E_LIVE=1 npx playwright test tests/e2e/live`.
  testIgnore: [
    ...(process.env.E2E_TOOLS === '1' ? [] : ['**/tools/**']),
    ...(process.env.E2E_LIVE === '1' ? [] : ['**/live/**']),
  ],
  timeout: 30000,
  // No retries: a test that fails once fails the build. See
  // docs/research/e2e-deterministic-selective.md.
  retries: 0,
  // One per CI shard: on a 3-core runner two Electron apps only contend. In run
  // 36344425737 each shard's wall time matched its summed test time with two
  // workers, and the session specs ran 50% slower than when paired with light
  // tests. Parallelism comes from the shards (ADR 071).
  // Locally, at most four copies of the app at once: the default (half the
  // cores) starts eight or more Electron apps in the same second on a machine
  // that is also running the app, its agents and their checks.
  workers: process.env.CI ? 1 : 4,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
})
