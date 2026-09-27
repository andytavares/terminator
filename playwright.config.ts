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
  // CI runners are resource-constrained and each test launches a full
  // Electron app, so cap parallelism.
  workers: process.env.CI ? 2 : undefined,
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
