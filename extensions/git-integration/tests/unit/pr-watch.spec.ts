import { describe, it, expect, vi } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../packages/test-support/src/fakes'
import { createPrWatch, type WatchStore } from '../../src/home/pr-watch-runner'
import { tailLines, type PrWatchReads, type PrWatchState } from '../../src/home/pr-watch'
import { dashboardPrFixture } from './support/dashboard-pr'
import { bindShellToAnswers } from './support/shell'

const PORCELAIN = 'worktree /work/widgets-login\nHEAD bbb\nbranch refs/heads/feat/login\n'
const FAILED_JOB = 'https://github.com/acme/widgets/actions/runs/987/job/4'
const failed = { name: 'E2E', state: 'failed' as const, detailsUrl: FAILED_JOB }
const passing = { name: 'E2E', state: 'passed' as const, detailsUrl: FAILED_JOB }
const comment = (at: string, author = 'reviewer') => ({ author, body: `note ${at}`, createdAt: at })

interface Options {
  enabled?: boolean
  live?: string[]
  resumable?: string | null
  dirty?: boolean
  comments?: ReturnType<typeof comment>[]
}

function fakeApi(options: Options) {
  const agents = {
    sessionsIn: vi.fn(async () => ({
      live: options.live ?? [],
      resumable: options.resumable ?? null,
    })),
    start: vi.fn(async () => ({ sessionId: 'resumed', agentId: 'claude', configOptions: [] })),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn' })),
    onEnd: vi.fn(() => () => undefined),
  }
  const api = partialFake<ExtensionAPI>({
    agents: partialFake<ExtensionAPI['agents']>(agents),
    settings: partialFake<ExtensionAPI['settings']>({
      get: (() => options.enabled ?? true) as never,
    }),
    usage: { record: vi.fn() },
    workspace: partialFake<ExtensionAPI['workspace']>({
      list: () => [{ id: 'w1', name: 'w1', folderPath: '/work/widgets' }],
      listProjects: () => [
        { id: 'p1', workspaceId: 'w1', name: 'login', worktreePath: '/work/widgets-login' },
      ],
    }),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  return { api, agents }
}

function memoryStore() {
  const saved = new Map<string, PrWatchState>()
  const store: WatchStore = {
    get: async (key) => saved.get(key),
    set: async (key, state) => void saved.set(key, state),
    delete: async (key) => void saved.delete(key),
  }
  return { saved, store }
}

function setup(options: Options = {}) {
  bindShellToAnswers((_command, args) =>
    args[0] === 'status' ? (options.dirty ? ' M src/a.ts' : '') : PORCELAIN
  )
  const { saved, store } = memoryStore()
  const { api, agents } = fakeApi(options)
  const reads: PrWatchReads = {
    viewer: async () => 'andrew',
    comments: async () => options.comments ?? [],
    failedLog: async () => 'line 1\nAssertionError: expected 1 to be 2',
  }
  const notes = vi.fn()
  const watch = createPrWatch({ api, store, onNotes: notes })
  const feed = (...prs: Parameters<typeof dashboardPrFixture>[0][]) =>
    watch.onDashboard(
      prs.map((pr) => dashboardPrFixture(pr)),
      reads
    )
  return { feed, agents, notes, saved, usage: api.usage.record }
}

describe('first snapshot', () => {
  it('acts on nothing, even with a failed check', async () => {
    const { feed, agents } = setup({ resumable: 'old' })
    await feed({ checks: [failed] })
    expect(agents.prompt).not.toHaveBeenCalled()
    expect(agents.start).not.toHaveBeenCalled()
  })
})

describe('a failed check', () => {
  it('prompts the live agent once, however many polls see the same failure', async () => {
    const { feed, agents, usage } = setup({ live: ['live-1'] })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    await feed({ checks: [failed] })
    expect(agents.prompt).toHaveBeenCalledTimes(1)
    const text = (agents.prompt.mock.calls[0] as unknown as [string, string])[1]
    expect(text).toContain('Sent by Terminator · pull request #275 · wake 1 of 10')
    expect(text).toContain('The check "E2E" failed')
    expect(text).toContain('AssertionError: expected 1 to be 2')
    expect(usage).toHaveBeenCalledWith('pr-watch-wake')
  })

  it('does nothing when the setting is off', async () => {
    const { feed, agents } = setup({ live: ['live-1'], enabled: false })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    expect(agents.prompt).not.toHaveBeenCalled()
  })

  it('publishes an Agent woken note with the wake count', async () => {
    const { feed, notes } = setup({ live: ['live-1'] })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    expect(notes.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ kind: 'woken', summary: 'Check failed: E2E', wake: 1 }),
    ])
  })
})

describe('a failed check beside another', () => {
  it('prompts the live agent for a check that fails beside one already failing', async () => {
    const unit = { ...failed, name: 'unit' }
    const { feed, agents } = setup({ live: ['live-1'] })
    await feed({ checks: [unit] })
    await feed({ checks: [unit, failed] })
    expect(agents.prompt).toHaveBeenCalledTimes(1)
    const text = (agents.prompt.mock.calls[0] as unknown as [string, string])[1]
    expect(text).toContain('The check "E2E" failed')
    expect(text).not.toContain('The check "unit" failed')
  })
})

describe('resuming an agent', () => {
  it('starts the recorded conversation once, then prompts it while it lives', async () => {
    const { feed, agents } = setup({ resumable: 'old-conversation' })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    expect(agents.start).toHaveBeenCalledWith({
      cwd: '/work/widgets-login',
      resume: 'old-conversation',
      tab: { projectId: 'p1', title: 'Pull request #275' },
    })
    expect(agents.prompt).toHaveBeenCalledWith('resumed', expect.any(String))
    agents.sessionsIn.mockResolvedValue({ live: ['resumed'], resumable: 'old-conversation' })
    await feed({ checks: [passing], updatedAt: '2026-10-17T09:00:00Z' })
    await feed({ checks: [failed], updatedAt: '2026-10-17T09:05:00Z' })
    expect(agents.start).toHaveBeenCalledTimes(1)
    expect(agents.prompt).toHaveBeenCalledTimes(2)
  })
})

describe('resuming an agent: limits', () => {
  it('resumes no second agent after the first ended', async () => {
    const { feed, agents } = setup({ resumable: 'old' })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    expect(agents.start).toHaveBeenCalledTimes(1)
  })

  it('resumes none once an agent it woke has ended', async () => {
    const { feed, agents } = setup({ live: ['live-1'], resumable: 'old' })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    const onEnd = agents.onEnd.mock.calls[0] as unknown as [string, () => void]
    onEnd[1]()
    agents.sessionsIn.mockResolvedValue({ live: [], resumable: 'old' })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    expect(agents.start).not.toHaveBeenCalled()
    expect(agents.prompt).toHaveBeenCalledTimes(1)
  })

  it('skips a worktree with uncommitted changes and no live agent', async () => {
    const { feed, agents } = setup({ resumable: 'old', dirty: true })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    expect(agents.start).not.toHaveBeenCalled()
    expect(agents.prompt).not.toHaveBeenCalled()
  })
})

const minute = (n: number) => `2026-10-17T09:${String(n).padStart(2, '0')}:00Z`
const moved = (n: number) => ({ updatedAt: minute(n) })

/** Feeds `count` dashboard snapshots in order, each after one new comment by someone else. */
async function feedNewComments(
  feed: ReturnType<typeof setup>['feed'],
  comments: ReturnType<typeof comment>[],
  count: number
) {
  for (let n = 1; n <= count; n++) {
    comments.push(comment(minute(n)))
    await feed(moved(n))
  }
}

describe('comments', () => {
  it('wakes on a comment by someone else only', async () => {
    const mine = comment('2026-10-17T09:01:00Z', 'andrew')
    const theirs = comment('2026-10-17T09:02:00Z')
    const { feed, agents } = setup({ live: ['live-1'], comments: [mine, theirs] })
    await feed({})
    await feed(moved(3))
    const text = (agents.prompt.mock.calls[0] as unknown as [string, string])[1]
    expect(text).toContain('reviewer wrote:\nnote 2026-10-17T09:02:00Z')
    expect(text).not.toContain('andrew wrote')
  })

  it('stops after ten wakes and says so on Home', async () => {
    const comments: ReturnType<typeof comment>[] = []
    const { feed, agents, notes } = setup({ live: ['live-1'], comments })
    await feed({})
    await feedNewComments(feed, comments, 11)
    expect(agents.prompt).toHaveBeenCalledTimes(10)
    expect(notes.mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({ kind: 'stopped' })])
  })
})

describe('a pull request that leaves my list', () => {
  it('clears its notes but keeps its counts, so its limits do not start again', async () => {
    const { feed, saved, notes } = setup({ live: ['live-1'] })
    await feed({ checks: [passing] })
    await feed({ checks: [failed] })
    const counts = [...saved.values()]
    await feed()
    expect([...saved.values()]).toEqual(counts)
    expect(notes.mock.calls.at(-1)?.[0]).toEqual([])
  })
})

describe('tailLines', () => {
  it('keeps the last lines', () => {
    expect(tailLines('a\nb\nc\n', 2)).toBe('b\nc')
  })
})
