import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  LINUX_CONTAINER,
  NOT_RUN_HERE,
  checkEnvironment,
  recordablePass,
  unverifiedPushes,
} from '../../../scripts/ci-local.mjs'

describe('the Linux container ci:local starts', () => {
  it('is one command bash can parse', () => {
    expect(() => execFileSync('bash', ['-n', '-c', LINUX_CONTAINER])).not.toThrow()
  })

  it('builds the image, then sends the tree into a container that runs the Linux plan', () => {
    const [build, rest] = LINUX_CONTAINER.split(' && git ls-files')
    expect(build).toMatch(/^docker build .* > \/dev\/null$/)
    expect(rest).toMatch(/\| docker run --rm -i /)
    expect(rest).toContain('node scripts/ci-local.mjs --linux')
  })
})

describe('what ci:local leaves to CI', () => {
  it('gives a reason for everything it does not run', () => {
    for (const reason of Object.values(NOT_RUN_HERE)) expect(reason).not.toBe('')
  })
})

describe('ci:local runs each check as CI would, outside any git hook', () => {
  it('drops the GIT_ variables a pre-push hook is given, and keeps the rest', () => {
    const fromHook = {
      GIT_DIR: '/repo/.git/worktrees/branch',
      GIT_PREFIX: '',
      GIT_EXEC_PATH: '/git-core',
      GIT_TRACE2_PARENT_SID: 'sid',
      PATH: '/usr/bin',
      HOME: '/Users/someone',
    }
    expect(checkEnvironment(fromHook)).toEqual({ PATH: '/usr/bin', HOME: '/Users/someone' })
  })
})

const PASSED = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const DELETED = '0'.repeat(40)
const pushLine = (localSha: string, ref = 'refs/heads/fix/branch') =>
  `${ref} ${localSha} ${ref} ${'c'.repeat(40)}`

describe('the pre-push hook lets through only what ci:local passed on', () => {
  it('lets through the commit ci:local passed on', () => {
    expect(unverifiedPushes(`${pushLine(PASSED)}\n`, PASSED)).toEqual([])
  })

  it('names each ref whose commit ci:local has not passed on', () => {
    const lines = [pushLine(PASSED), pushLine(OTHER, 'refs/heads/other')].join('\n')
    expect(unverifiedPushes(lines, PASSED)).toEqual(['refs/heads/other'])
  })

  it('refuses everything when ci:local has never passed here', () => {
    expect(unverifiedPushes(pushLine(PASSED), null)).toEqual(['refs/heads/fix/branch'])
  })

  it('lets a deleted ref through, since it pushes no code', () => {
    expect(unverifiedPushes(pushLine(DELETED), null)).toEqual([])
  })
})

describe('ci:local records a pass only for a commit it tested', () => {
  const clean = { headBefore: PASSED, headAfter: PASSED, changesBefore: '', changesAfter: '' }

  it('records a clean tree whose commit did not move', () => {
    expect(recordablePass(clean)).toBe(true)
  })

  it('records nothing when there were uncommitted changes, which no commit holds', () => {
    expect(recordablePass({ ...clean, changesBefore: ' M src/main/index.ts\n' })).toBe(false)
    expect(recordablePass({ ...clean, changesAfter: '?? scratch.txt\n' })).toBe(false)
  })

  it('records nothing when HEAD moved during the run', () => {
    expect(recordablePass({ ...clean, headAfter: OTHER })).toBe(false)
  })
})
