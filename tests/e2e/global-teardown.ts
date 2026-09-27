import { rmSync } from 'node:fs'
import type { FullConfig } from '@playwright/test'

// Runs once after every worker has exited — never inside a spec's afterAll —
// so a profile a dying Electron process is still flushing to (a terminal's
// scrollback, an extension's state, a transcript) can no longer surface as an
// ENOTEMPTY that fails that file's last test. Cleanup can never fail a test:
// wrapped so this function itself never throws, whatever is left on disk.
export default function globalTeardown(_config: FullConfig): void {
  const root = process.env.TERMINATOR_E2E_RUN_ROOT
  if (!root) return
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  } catch {
    // Never throws — a leftover directory is the next run's problem to avoid
    // by using its own root, not this run's test result.
  }
}
