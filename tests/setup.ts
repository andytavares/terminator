// Global test setup — runs before every test file regardless of environment.
// CSS modules are not processed in tests; mock them to return an empty object.
import { afterAll, inject, vi } from 'vitest'
import { removeTempDirs } from './support/temp-dir'

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

// git maintenance is off under this XDG config; tests/global-setup.ts says why.
process.env.XDG_CONFIG_HOME = inject('xdgConfigHome')

// Registered before the spec's own hooks so it runs after them (afterAll runs in reverse,
// https://vitest.dev/config/sequence#sequence-hooks): they close what is inside first.
afterAll(removeTempDirs)

// A trace2 event target in the operator's global git config (git-ai's daemon)
// answers every commit and fetch by writing notes and objects into `.git` for
// seconds after git returns, so a spec that deletes its temporary repository
// races it and fails with ENOTEMPTY. trace2 is read only from global config and
// the environment, so the environment is the one place to turn it off. Specs
// that scrub GIT_* from git's environment keep this one.
process.env.GIT_TRACE2_EVENT = '0'

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

// jsdom parses its user-agent stylesheet (300+ ms) on a file's first getComputedStyle, which
// every ByRole query calls; paid here, not by whichever test queries first.
if (typeof window !== 'undefined') window.getComputedStyle(document.documentElement)
