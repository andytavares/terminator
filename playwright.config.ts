import { defineConfig } from '@playwright/test'
import { e2eWorkerCount } from './tests/e2e/worker-count'
import { TEST_TIME_ZONE } from './scripts/test-env.mjs'

// The app runs in the sealed time zone; a spec that works out "today" must use the same one, or
// between the two zones' midnights (8 pm to midnight in New York) they name different days.
// Workers inherit it from here.
process.env.TZ = TEST_TIME_ZONE

// Specs that use what a machine has one of (the clipboard, remote-control port 17683, the
// keychain) run one at a time in their own project; two at once read each other's clipboard.
const SHARED_MACHINE_RESOURCES = [
  '**/core-quick-actions.spec.ts',
  '**/issue-trackers.spec.ts',
  '**/remote-control.spec.ts',
]

// Run only on purpose: `tools/` rewrites committed screenshots (E2E_TOOLS=1).
const NOT_IN_THE_SUITE = [...(process.env.E2E_TOOLS === '1' ? [] : ['**/tools/**'])]

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
    },
    {
      name: 'shared-machine-resources',
      testMatch: SHARED_MACHINE_RESOURCES,
      testIgnore: NOT_IN_THE_SUITE,
      workers: 1,
    },
  ],
})
