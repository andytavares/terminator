import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
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
//
// Electron downloads its binary on the first `require('electron')`, and
// Playwright makes that call in each worker as it launches. With no binary
// yet, one worker is still extracting it when another sees the executable and
// launches a half-written Electron Framework, which dyld refuses. Resolving it
// here, before any worker is forked, downloads it once.
export default function globalSetup(_config: FullConfig): void {
  createRequire(import.meta.url)('electron')
  const root = join(tmpdir(), `terminator-e2e-run-${process.pid}`)
  mkdirSync(root, { recursive: true })
  process.env.TERMINATOR_E2E_RUN_ROOT = root
}
