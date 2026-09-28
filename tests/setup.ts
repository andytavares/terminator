// Global test setup — runs before every test file regardless of environment.
// CSS modules are not processed in tests; mock them to return an empty object.
import { vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

// A git hook exports GIT_DIR and GIT_INDEX_FILE, and a spec's `git init` or
// `git commit` in a temporary directory inherits them and writes into the real
// repository instead. The list is `git rev-parse --local-env-vars`.
for (const name of [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
]) {
  delete process.env[name]
}

// `git commit` and `git fetch` start `git maintenance run --auto --detach`,
// which keeps writing into a spec's temporary repository after the command
// returns; the spec's cleanup then fails with ENOTEMPTY whenever the machine is
// busy. Turned off through git's XDG config file rather than a GIT_* variable:
// the local GIT_* variables are forbidden above, and specs scrub the rest before
// running git. The operator's own XDG config is included so nothing else changes.
const realXdgGitConfig = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'git',
  'config'
)
// One fixed file shared by every worker, rewritten only when it differs: a
// worker truncating it while another's git reads it would switch maintenance
// back on for that command.
const xdgHome = join(tmpdir(), 'terminator-vitest-xdg')
const xdgGitConfig = join(xdgHome, 'git', 'config')
const wanted = `[include]\n\tpath = ${realXdgGitConfig}\n[maintenance]\n\tauto = false\n`
if (!existsSync(xdgGitConfig) || readFileSync(xdgGitConfig, 'utf8') !== wanted) {
  mkdirSync(join(xdgHome, 'git'), { recursive: true })
  const staged = `${xdgGitConfig}.${randomUUID()}`
  writeFileSync(staged, wanted)
  renameSync(staged, xdgGitConfig)
}
process.env.XDG_CONFIG_HOME = xdgHome

vi.mock('*.css', () => ({}))
vi.mock('*.module.css', () => ({ default: {} }))

// JSDOM does not fully implement the Selection API; patch it to prevent React DOM
// from crashing with "Right-hand side of 'instanceof' is not an object" when
// rendering components with form elements (inputs, checkboxes).
if (typeof window !== 'undefined' && !window.getSelection) {
  window.getSelection = (): Selection | null => null
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
