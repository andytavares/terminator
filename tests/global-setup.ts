// Runs once per Vitest project, in the main process, before any spec file
// (https://vitest.dev/config/globalsetup). What it makes it also removes, so a
// run leaves nothing in the temporary directory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The XDG_CONFIG_HOME every spec runs git under; tests/setup.ts sets it. */
    xdgConfigHome: string
  }
}

// `git commit` and `git fetch` start `git maintenance run --auto --detach`,
// which keeps writing into a spec's temporary repository after the command
// returns; the spec's cleanup then fails with ENOTEMPTY whenever the machine is
// busy. Turned off through git's XDG config file rather than a GIT_* variable:
// the local GIT_* variables are forbidden in tests/setup.ts, and specs scrub the
// rest before running git. The operator's own XDG config is included so nothing
// else changes. Written once, before any worker starts, so no git reads it half
// written.
function writeXdgGitConfig(): string {
  const operatorConfig = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'git',
    'config'
  )
  const xdgHome = mkdtempSync(join(tmpdir(), 'terminator-vitest-xdg-'))
  mkdirSync(join(xdgHome, 'git'))
  writeFileSync(
    join(xdgHome, 'git', 'config'),
    `[include]\n\tpath = ${operatorConfig}\n[maintenance]\n\tauto = false\n`
  )
  return xdgHome
}

export default function setup(project: TestProject): () => void {
  const xdgHome = writeXdgGitConfig()
  project.provide('xdgConfigHome', xdgHome)
  return () => rmSync(xdgHome, { recursive: true, force: true })
}
