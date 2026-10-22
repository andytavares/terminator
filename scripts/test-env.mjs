// The environment every test process runs in, the same in CI, in ci:local and in a plain
// `npm test` (ADR 123). It is built from fixed values and a short allowlist, never by copying
// the developer's environment: their git config, shell variables, time zone and agent sockets
// once changed what a test saw.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The global git config a test's git reads, in place of the developer's ~/.gitconfig. */
export const GIT_CONFIG_FIXTURE = join(REPO_ROOT, 'tests/fixtures/git/gitconfig')

const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

/** Variables passed through as they are: they name the run, not the developer. */
const PASSED_THROUGH = [
  'ELECTRON_OVERRIDE_DIST_PATH',
  'GITHUB_ACTIONS',
  'GITHUB_RUN_ID',
  'RUNNER_OS',
  'RUNNER_TEMP',
  'USER',
  'LOGNAME',
  'TERM',
]

const FIXED = {
  TZ: 'UTC',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  CI: '1',
  GIT_CONFIG_GLOBAL: GIT_CONFIG_FIXTURE,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TRACE2_EVENT: '0',
  GIT_TERMINAL_PROMPT: '0',
  SHELL: '/bin/zsh',
  NODE_ENV: 'test',
}

/**
 * The environment of one run. `home` and `tmpdir` are fresh directories the caller made for
 * it; `stubs` are directories put first on PATH (fake `claude`, `gh`). `inherited` is read only
 * for the allowlist above.
 */
export function testEnvironment({ home, tmpdir, stubs = [] }, inherited = process.env) {
  const passed = PASSED_THROUGH.filter((name) => inherited[name] !== undefined).map((name) => [
    name,
    inherited[name],
  ])
  const path = [...stubs, dirname(process.execPath), ...SYSTEM_PATH].join(':')
  return { ...Object.fromEntries(passed), ...FIXED, HOME: home, TMPDIR: tmpdir, PATH: path }
}
