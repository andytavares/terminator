import { defineConfig } from '@playwright/test'
import { e2eWorkerCount } from './tests/e2e/worker-count'

// Specs that use something one machine has only one of: the system clipboard, the remote-control
// port 17683, the keychain. Running two at once makes one read the other's clipboard or lose the
// port, so they run alone, one file at a time, after the rest.
const SHARED_MACHINE_RESOURCES = [
  '**/core-quick-actions.spec.ts',
  '**/issue-trackers.spec.ts',
  '**/remote-control.spec.ts',
]

// `tools/` holds specs that write into the repository — screenshot capture
// for the user guide. They are run deliberately, never as part of the suite,
// because a CI run that rewrites a committed file leaves a dirty tree. Set
// `E2E_TOOLS=1` to include them.
// `live/` holds specs that launch real agents against a real remote. They
// cost time and quota and are inherently non-deterministic, so they are run
// deliberately: `E2E_LIVE=1 npx playwright test tests/e2e/live`.
const NOT_IN_THE_SUITE = [
  ...(process.env.E2E_TOOLS === '1' ? [] : ['**/tools/**']),
  ...(process.env.E2E_LIVE === '1' ? [] : ['**/live/**']),
]

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: NOT_IN_THE_SUITE,
  // One bound per test and one per assertion, there only to catch a hang: far above any real
  // duration, so a slower runner never changes a result (ADR 123). Specs may not set their own.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // No retries: a test that fails once fails the build. See
  // docs/research/e2e-deterministic-selective.md.
  retries: 0,
  // The same rule in CI and locally: see e2eWorkerCount.
  workers: e2eWorkerCount(),
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testIgnore: [...NOT_IN_THE_SUITE, ...SHARED_MACHINE_RESOURCES],
      // A teardown project runs once the project has finished, pass or fail; a dependency
      // would skip the rest of the suite when one of these specs failed.
      teardown: 'shared-machine-resources',
    },
    {
      name: 'shared-machine-resources',
      testMatch: SHARED_MACHINE_RESOURCES,
      testIgnore: NOT_IN_THE_SUITE,
      workers: 1,
    },
  ],
})
