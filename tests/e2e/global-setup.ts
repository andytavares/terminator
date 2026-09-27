import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FullConfig } from '@playwright/test'

// One directory holds every profile this whole run creates — across every
// worker, and tests/e2e/remote-app.spec.ts, which launches Electron itself
// rather than through launchApp(). Playwright forks workers from this same
// process, so an env var set here is inherited by every one of them; see
// https://playwright.dev/docs/test-global-setup-teardown. `global-teardown.ts`
// removes the whole root once every worker has exited, so an individual
// spec's cleanup (closeApp) never has to delete anything and can never fail
// a test over a directory that is still being written to.
export default function globalSetup(_config: FullConfig): void {
  const root = join(tmpdir(), `terminator-e2e-run-${process.pid}`)
  mkdirSync(root, { recursive: true })
  process.env.TERMINATOR_E2E_RUN_ROOT = root
}
