import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FullConfig } from '@playwright/test'

// One directory holds every profile this whole run creates, across every
// worker. Playwright forks workers from this same process, so an env var set
// here is inherited by every one of them; see
// https://playwright.dev/docs/test-global-setup-teardown. `global-teardown.ts`
// removes the whole root once every worker has exited, so an individual
// spec's cleanup (closeApp) never has to delete anything and can never fail
// a test over a directory that is still being written to.
export default function globalSetup(_config: FullConfig): void {
  const root = join(tmpdir(), `terminator-e2e-run-${process.pid}`)
  mkdirSync(root, { recursive: true })
  process.env.TERMINATOR_E2E_RUN_ROOT = root
  // As tests/setup.ts does for Vitest: git-ai's trace2 target writes into a spec's temporary
  // repository for seconds after git returns, so deleting it fails with ENOTEMPTY.
  process.env.GIT_TRACE2_EVENT = '0'
}
