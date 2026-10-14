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

// Turns off `git maintenance run --auto --detach`, which writes into a spec's repository after
// the command returns (cleanup then fails with ENOTEMPTY), through git's XDG config: specs scrub
// GIT_* variables. Includes the operator's own, and is written before any worker starts.
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

export default function setupSpecGitConfig(project: TestProject): () => void {
  const xdgHome = writeXdgGitConfig()
  project.provide('xdgConfigHome', xdgHome)
  return () => rmSync(xdgHome, { recursive: true, force: true })
}
