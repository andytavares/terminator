import { describe, it, expect, vi } from 'vitest'
import { eventually } from '../../support/eventually'
import {
  NOT_RUN_HERE,
  checkEnvironment,
  checkoutPaths,
  checksPushes,
  cleanArguments,
  jobsOf,
  laneOf,
  lockHash,
  needsInstall,
  nodeMismatch,
  parseFlags,
  passRecord,
  passedHead,
  unverifiedPushes,
  publishWhenPushed,
  runScheduled,
} from '../../../scripts/ci-local.mjs'

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
const MAIN = 'd'.repeat(40)
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

describe("the pre-push hook runs only on a person's machine", () => {
  it('checks a push made outside CI', () => {
    expect(checksPushes({ PATH: '/usr/bin' })).toBe(true)
  })

  it('lets a CI job push its own commit, since CI runs the checks itself', () => {
    expect(checksPushes({ CI: 'true', PATH: '/usr/bin' })).toBe(false)
  })
})

describe('the pass record names the commit and the main it was merged with', () => {
  it('writes both shas and reads the tested commit back', () => {
    expect(passRecord(PASSED, MAIN)).toBe(`${PASSED} ${MAIN}\n`)
    expect(passedHead(passRecord(PASSED, MAIN))).toBe(PASSED)
  })

  it('reads no commit from a missing or empty record', () => {
    expect(passedHead(null)).toBeNull()
    expect(passedHead('')).toBeNull()
  })
})

describe('ci:local runs on the Node that CI runs', () => {
  it('accepts the version in .nvmrc', () => {
    expect(nodeMismatch('v24.21.0', '24.21.0\n')).toBeNull()
  })

  it('names both versions when they differ', () => {
    const message = nodeMismatch('v22.1.0', '24.21.0\n')
    expect(message).toContain('v22.1.0')
    expect(message).toContain('v24.21.0')
  })
})

describe('ci:local reinstalls only when the lockfile changed', () => {
  it('hashes the lockfile contents', () => {
    expect(lockHash('a')).toBe(lockHash('a'))
    expect(lockHash('a')).not.toBe(lockHash('b'))
  })

  it('installs when nothing was recorded or the hash differs', () => {
    expect(needsInstall(lockHash('a'), null)).toBe(true)
    expect(needsInstall(lockHash('a'), lockHash('b'))).toBe(true)
  })

  it('keeps node_modules when the recorded hash matches', () => {
    expect(needsInstall(lockHash('a'), `${lockHash('a')}\n`)).toBe(false)
  })
})

describe('ci:local flags', () => {
  it('defaults to the selection', () => {
    expect(parseFlags([])).toEqual({
      all: false,
      checkPush: false,
      prepareOnly: false,
      publishStatus: false,
    })
  })

  it('reads each flag', () => {
    expect(parseFlags(['--all', '--check-push', '--prepare-only', '--publish-status'])).toEqual({
      all: true,
      checkPush: true,
      prepareOnly: true,
      publishStatus: true,
    })
  })
})

describe('publishing the local-check status once GitHub has the commit', () => {
  it('posts as soon as the pushed commit exists there', async () => {
    const asked: number[] = []
    const exists = async () => asked.push(asked.length) >= 3
    const post = vi.fn(async () => undefined)
    expect(await publishWhenPushed({ exists, post, pause: async () => undefined, tries: 10 })).toBe(
      true
    )
    expect(asked).toHaveLength(3)
    expect(post).toHaveBeenCalledOnce()
  })

  it('gives up without posting when the commit never arrives', async () => {
    const post = vi.fn(async () => undefined)
    const exists = async () => false
    expect(await publishWhenPushed({ exists, post, pause: async () => undefined, tries: 4 })).toBe(
      false
    )
    expect(post).not.toHaveBeenCalled()
  })
})

describe('the checkout between jobs', () => {
  it('is cleaned as a fresh one, keeping node_modules and what CI hands on as artifacts', () => {
    expect(cleanArguments(['.vitest-reports', 'blob-report'])).toEqual([
      'clean',
      '-fdxq',
      '-e',
      'node_modules',
      '-e',
      '.vitest-reports',
      '-e',
      'blob-report',
    ])
  })
})

const job = (id: string, needs: string[] = []) => ({ id, needs, steps: [] })

/** A job runner whose jobs run until the test ends them: `end(id, passed)`. */
function gatedRunner() {
  const events: string[] = []
  const gates = new Map<string, (passed: boolean) => void>()
  const runJob = (running: { id: string }) =>
    new Promise<boolean>((resolve) => {
      events.push(`start ${running.id}`)
      gates.set(running.id, (passed) => {
        events.push(`end ${running.id}`)
        resolve(passed)
      })
    })
  return { events, runJob, end: (id: string, passed = true) => gates.get(id)?.(passed) }
}

describe('the scheduler runs jobs as CI does, each when what it needs has passed', () => {
  it('starts independent jobs together', async () => {
    const { events, runJob, end } = gatedRunner()
    const done = runScheduled([job('lint'), job('format')], runJob)
    await eventually(() => expect(events).toEqual(['start lint', 'start format']))
    end('lint')
    end('format')
    await done
  })

  it('starts a job only after every job it needs has ended', async () => {
    const { events, runJob, end } = gatedRunner()
    const jobs = [job('test', ['unit', 'stability']), job('unit'), job('stability')]
    const done = runScheduled(jobs, runJob)
    await eventually(() => expect(events).toEqual(['start unit', 'start stability']))
    end('unit')
    end('stability')
    await eventually(() => expect(events).toContain('start test'))
    expect(events.indexOf('start test')).toBeGreaterThan(events.indexOf('end stability'))
    end('test')
    await done
  })
})

describe('the scheduler when a job fails', () => {
  it('never starts a job whose need failed, and reports it skipped, down the chain', async () => {
    const { events, runJob, end } = gatedRunner()
    const jobs = [job('unit'), job('test', ['unit']), job('report', ['test']), job('lint')]
    const done = runScheduled(jobs, runJob)
    await eventually(() => expect(events).toEqual(['start unit', 'start lint']))
    end('unit', false)
    end('lint')
    expect(await done).toEqual([
      { id: 'unit', status: 'failed' },
      { id: 'test', status: 'skipped' },
      { id: 'report', status: 'skipped' },
      { id: 'lint', status: 'passed' },
    ])
    expect(events).not.toContain('start test')
  })

  it('lets a job already running finish when another fails', async () => {
    const { events, runJob, end } = gatedRunner()
    const done = runScheduled([job('lint'), job('format')], runJob)
    await eventually(() => expect(events).toHaveLength(2))
    end('lint', false)
    end('format')
    expect((await done).map((outcome) => outcome.status)).toEqual(['failed', 'passed'])
  })
})

describe('the scheduler and a need outside the plan', () => {
  it('counts a need that is not in the plan as passed', async () => {
    const { events, runJob, end } = gatedRunner()
    const done = runScheduled([job('unit', ['select'])], runJob)
    await eventually(() => expect(events).toEqual(['start unit']))
    end('unit')
    await done
  })
})

describe('the plan, as jobs', () => {
  const ubuntu = 'ubuntu-24.04-arm'
  const step = (jobId: string, runner = ubuntu) => ({ job: jobId, runner, name: 'x', script: 'x' })
  const needs = { unit: { needs: 'select' }, test: { needs: ['select', 'unit'] } }
  const workflow = { jobs: { ...needs, lint: {} } }

  it('groups the steps of a job, in order, with the jobs it needs', () => {
    const steps = [step('lint'), step('unit'), step('unit'), step('test')]
    expect(jobsOf(steps, workflow).map((j) => [j.id, j.steps.length, j.needs])).toEqual([
      ['lint', 1, []],
      ['unit', 2, ['select']],
      ['test', 1, ['select', 'unit']],
    ])
  })

  it('puts a job on the Linux lane when CI runs it on Ubuntu, and on the Mac lane otherwise', () => {
    expect(laneOf(jobsOf([step('lint')], workflow)[0])).toBe('linux')
    expect(laneOf(jobsOf([step('start', 'macos-26')], workflow)[0])).toBe('mac')
  })
})

describe('the two checkouts', () => {
  it('gives the Linux lane its own worktree beside the Mac lane, so the lanes cannot collide', () => {
    expect(checkoutPaths('/repo')).toEqual({
      mac: '/repo/.worktrees/.ci-local',
      linux: '/repo/.worktrees/.ci-local-linux',
    })
  })
})
