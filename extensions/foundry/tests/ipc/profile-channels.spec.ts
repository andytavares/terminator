import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { createProfileChannels } from '../../src/ipc/profile-channels.js'
import type { ProfileChannels } from '../../src/ipc/profile-channels.js'
import type { BaselineDeps } from '../../src/line/baseline.js'
import { draftOrder } from '../../src/order/draft.js'
import { createOrderStore } from '../../src/order/store.js'
import type { OrderStore } from '../../src/order/store.js'
import { defaultHintsDir } from '../../src/profile/hints.js'
import { readProfile } from '../../src/profile/store.js'
import { gitAt, realGit, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'

let parent: string
let repo: string
let root: string
let store: OrderStore
let channels: ProfileChannels
const runCommand = vi.fn<BaselineDeps['runCommand']>()

beforeEach(async () => {
  parent = temporaryDirectory('profile-channels')
  repo = await seededRepository(parent)
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ scripts: { lint: 'eslint .' } })
  )
  await gitAt(repo, 'add', '-A')
  await gitAt(repo, 'commit', '-q', '-m', 'scripts')
  root = path.join(parent, 'data')
  store = createOrderStore(root)
  runCommand.mockReset().mockImplementation(async ({ logPath }) => {
    if (logPath !== undefined) fs.writeFileSync(logPath, '')
    return 0
  })
  channels = createProfileChannels({
    dataRoot: () => root,
    hintsDir: defaultHintsDir(),
    store,
    baseline: () => ({
      root,
      now: () => '2026-09-06T10:00:00.000Z',
      exec: realGit,
      workspaceOf: () => 'workspace-1',
      record: store.record,
      runCommand,
    }),
  })
})

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true })
})

describe('foundry:profile-save and foundry:profile-read', () => {
  it('shows a hint with its source until the operator saves a command, which then wins', async () => {
    const before = (await channels.read({ repoPath: repo })) as { checks: { lint: unknown } }
    expect(before.checks.lint).toMatchObject({
      command: expect.stringContaining('lint'),
      source: 'hint',
    })
    await channels.save({ repoPath: repo, checks: { lint: 'make lint' } })
    const after = (await channels.read({ repoPath: repo })) as { checks: { lint: unknown } }
    expect(after.checks.lint).toEqual({ command: 'make lint', source: 'operator' })
  })
})

describe('foundry:profile-save clearing and listing', () => {
  it('clears an operator entry with null, and leaves the others alone', async () => {
    await channels.save({ repoPath: repo, checks: { lint: 'make lint', test: 'make test' } })
    await channels.save({ repoPath: repo, checks: { lint: null } })
    const stored = await readProfile(root, repo)
    expect(stored?.checks.lint).toBeNull()
    expect(stored?.checks.test).toEqual({ command: 'make test', source: 'operator' })
  })

  it('saves prepare, pictures, additional checks, share and paths as the operator', async () => {
    await channels.save({
      repoPath: repo,
      prepare: 'make setup',
      pictures: 'make pictures',
      additional: [{ name: 'Types', command: 'make types', rung: 'L1' }],
      share: ['.env'],
      paths: { interface: ['src/api'] },
    })
    const stored = await readProfile(root, repo)
    expect(stored).toMatchObject({
      prepare: { command: 'make setup', source: 'operator' },
      pictures: { command: 'make pictures', source: 'operator' },
      additional: [{ name: 'Types', command: 'make types', rung: 'L1', source: 'operator' }],
      share: ['.env'],
      paths: { interface: ['src/api'] },
    })
  })
})

describe('foundry:profile-read and the proof', () => {
  it('reads the proof stored with the profile', async () => {
    await channels.prove({ repoPath: repo, command: 'make lint' })
    const read = (await channels.read({ repoPath: repo })) as { proof: { exitCodes: unknown } }
    expect(read.proof.exitCodes).toEqual({ 'make lint': 0 })
  })
})

describe('foundry:profile-save on a draft order', () => {
  it('seeds a draft order on that repository from the profile, and leaves others alone', async () => {
    const make = (id: string, status: 'draft' | 'agreed') => ({
      ...draftOrder({
        id,
        title: id,
        source: { kind: 'typed' as const, tracker: null, key: null, url: null },
        repoPaths: [repo],
        now: '2026-09-06T10:00:00.000Z',
      }),
      status,
    })
    await store.save(make('WO-DRAFT', 'draft'))
    await store.save(make('WO-AGREED', 'agreed'))
    await channels.save({ repoPath: repo, checks: { lint: 'make lint' }, prepare: 'make setup' })
    const draft = await store.load('WO-DRAFT')
    expect(draft?.context.toolchain.lint).toMatchObject({
      command: 'make lint',
      source: 'operator',
    })
    expect(draft?.context.environment.prepare).toBe('make setup')
    expect((await store.load('WO-AGREED'))?.context.toolchain.lint).toBeNull()
  })
})

describe('foundry:profile-prove', () => {
  it('runs the command on a fresh base checkout and returns its exit code, log and commit', async () => {
    runCommand.mockImplementation(async ({ logPath }) => {
      if (logPath !== undefined) fs.writeFileSync(logPath, 'boom')
      return 3
    })
    const head = (await gitAt(repo, 'rev-parse', 'main')).stdout.trim()
    const result = (await channels.prove({ repoPath: repo, command: 'make lint' })) as {
      exitCode: number
      logPath: string
      commit: string
    }
    expect(result).toMatchObject({ exitCode: 3, commit: head })
    expect(fs.readFileSync(result.logPath, 'utf8')).toBe('boom')
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'make lint' }))
    expect((await readProfile(root, repo))?.proof).toMatchObject({
      commit: head,
      exitCodes: { 'make lint': 3 },
    })
    const listed = (await gitAt(repo, 'worktree', 'list', '--porcelain')).stdout
    expect(listed.split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1)
  })
})

describe('foundry:profiles-list and foundry:profile-forget', () => {
  it('lists a stored profile with its command count and proof, and forgets it', async () => {
    await channels.save({ repoPath: repo, checks: { lint: 'make lint', test: 'make test' } })
    await channels.prove({ repoPath: repo, command: 'make lint' })
    const head = (await gitAt(repo, 'rev-parse', 'main')).stdout.trim()
    const listed = (await channels.list()) as { profiles: unknown[] }
    expect(listed.profiles).toEqual([
      {
        repository: repo,
        commands: 2,
        proofCommit: head,
        provedAt: '2026-09-06T10:00:00.000Z',
      },
    ])
    await channels.forget({ repoPath: repo })
    expect(await readProfile(root, repo)).toBeNull()
    expect(await channels.list()).toEqual({ profiles: [] })
  })
})

describe('foundry:profile-save removing a command', () => {
  type Read = { checks: { lint: unknown }; removed: string[] }
  const read = async () => (await channels.read({ repoPath: repo })) as Read

  it('resolves a check to none, beating the hint, and says it was removed', async () => {
    await channels.save({ repoPath: repo, remove: ['lint'] })
    const after = await read()
    expect(after.checks.lint).toBeNull()
    expect(after.removed).toEqual(['lint'])
    expect((await readProfile(root, repo))?.checks.lint).toEqual({
      command: null,
      source: 'operator',
    })
  })

  it('restores what the other sources say when the removal is cleared with null', async () => {
    await channels.save({ repoPath: repo, remove: ['lint'] })
    await channels.save({ repoPath: repo, checks: { lint: null } })
    const after = await read()
    expect(after.checks.lint).toMatchObject({ source: 'hint' })
    expect(after.removed).toEqual([])
  })
})

describe('a removed command on a draft order', () => {
  it('seeds a draft order with no command for the removed check', async () => {
    const draft = draftOrder({
      id: 'WO-DRAFT',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: [repo],
      now: '2026-09-06T10:00:00.000Z',
    })
    await store.save(draft)
    await channels.save({ repoPath: repo, remove: ['lint'] })
    expect((await store.load('WO-DRAFT'))?.context.toolchain.lint).toBeNull()
  })
})

describe('foundry:profile-save removing a command, in the lists', () => {
  it('does not count a removed command among the repository’s commands', async () => {
    await channels.save({ repoPath: repo, checks: { test: 'make test' }, remove: ['lint'] })
    const listed = (await channels.list()) as { profiles: { commands: number }[] }
    expect(listed.profiles[0].commands).toBe(1)
  })
})

const LOG_LINES = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`)
const inRecords = (name: string) => path.join(root, 'logs', name)
const tail = (target: string) =>
  channels.logTail({ path: target }) as Promise<{ tail?: string; error?: string }>

/** A 100-line log in the records, and a file beside the records that must stay unread. */
function seedLogs(): void {
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  fs.writeFileSync(inRecords('a.log'), LOG_LINES.join('\n') + '\n')
  fs.writeFileSync(path.join(parent, 'secret.txt'), 'secret')
}

describe('foundry:log-tail', () => {
  beforeEach(seedLogs)

  it('returns the last 40 lines of a log kept in the records', async () => {
    const answer = await tail(inRecords('a.log'))
    expect(answer.tail?.split('\n')).toEqual(LOG_LINES.slice(60))
  })
})

describe('foundry:log-tail refusing what is not a record', () => {
  beforeEach(seedLogs)

  it('refuses a file outside the records', async () => {
    expect((await tail(path.join(parent, 'secret.txt'))).error).toMatch(/only reads logs/i)
  })

  it('refuses a .. escape out of the records', async () => {
    const escape = path.join(root, 'logs', '..', '..', 'secret.txt')
    const answer = await tail(escape)
    expect(answer.error).toMatch(/only reads logs/i)
    expect(answer.tail).toBeUndefined()
  })

  it('refuses a symlink in the records that points out', async () => {
    fs.symlinkSync(path.join(parent, 'secret.txt'), inRecords('link.log'))
    const answer = await tail(inRecords('link.log'))
    expect(answer.error).toMatch(/only reads logs/i)
    expect(answer.tail).toBeUndefined()
  })

  it('answers in words, not a rejection, before the data root exists', async () => {
    fs.rmSync(root, { recursive: true, force: true })
    const answer = await tail(path.join(parent, 'secret.txt'))
    expect(answer.error).toMatch(/only reads logs/i)
  })

  it('says so in plain words when the log is gone', async () => {
    expect((await tail(inRecords('gone.log'))).error).toMatch(/no log/i)
  })
})
