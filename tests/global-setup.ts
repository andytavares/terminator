// Runs once per Vitest project, in the main process, before any spec file
// (https://vitest.dev/config/globalsetup). What it makes it also removes, so a
// run leaves nothing in the temporary directory.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TestProject } from 'vitest/node'
import { testEnvironment } from '../scripts/test-env.mjs'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The whole environment of a spec's process; tests/support/seal-worker-environment.ts applies it. */
    sealedEnvironment: Record<string, string>
  }
}

// Electron 42 downloads its binary on the first require('electron'), which specs reach through
// externalised dependencies vi.mock cannot intercept. No unit test runs the binary; the override
// makes the require a path join.
const ELECTRON_DIST = resolve(__dirname, '../node_modules/electron/dist')

// The home is fresh and empty. XDG_CONFIG_HOME sits inside it, empty too: git reads
// GIT_CONFIG_GLOBAL (tests/fixtures/git/gitconfig) and never the developer's config.
function sealedEnvironmentFor(home: string): Record<string, string> {
  const xdgConfigHome = join(home, '.config')
  mkdirSync(xdgConfigHome)
  // The inherited TMPDIR is the sandbox scripts/check-temp-leaks.mjs set up, if any.
  const tmpdirOfTheRun = process.env.TMPDIR ?? tmpdir()
  return {
    ...testEnvironment({ home, tmpdir: tmpdirOfTheRun }),
    ELECTRON_OVERRIDE_DIST_PATH: ELECTRON_DIST,
    XDG_CONFIG_HOME: xdgConfigHome,
  }
}

export default function sealSpecEnvironment(project: TestProject): () => void {
  const home = mkdtempSync(join(tmpdir(), 'terminator-vitest-home-'))
  project.provide('sealedEnvironment', sealedEnvironmentFor(home))
  return () => rmSync(home, { recursive: true, force: true })
}
