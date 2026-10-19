import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))
vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('electron-store', () => ({
  default: class {
    get() {
      return undefined
    }
    set() {}
    delete() {}
  },
}))
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerGithubHandlers, type GithubHandlerOptions } from '../../src/ipc/github.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { githubOverStub, bindShellToStub, stubAnswering } from './support/shell'

bindShellToStub(mockExecFile)
bindWorkspaceRoots(() => ['/repo'])

// api.paths.globalStorage: where gh runs when it needs no checkout, inside a root the core allows.
const GLOBAL_STORAGE =
  '/Users/me/Library/Application Support/Terminator/extensions/terminator.git-integration'

type Handler = (payload: unknown) => Promise<unknown>

/** Registers each channel into `handlers`, answered as the core answers an invoke. */
function captureHandlers(options: GithubHandlerOptions = {}): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers(
    (spec: ChannelSpec) => {
      handlers[spec.channel] = (payload) => dispatchChannel(spec, payload)
    },
    { github: githubOverStub(mockExecFile), getToken: () => '', noCheckoutCwd: GLOBAL_STORAGE },
    options
  )
  return handlers
}

/** A pull request as a search returns it: repository, number, and the kind's own fields. */
interface SearchNode {
  repository: { nameWithOwner: string }
  number: number
  createdAt?: string | null
  mergedAt?: string | null
  reviews?: { nodes: Array<{ submittedAt: string | null }> }
}

/** What gh prints for one paginated search through the channel's jq: the issueCount on the
 *  first line, then one compact JSON object per node (repository and reviews flattened),
 *  line-delimited. */
function searchReply(nodes: SearchNode[], issueCount = nodes.length): string {
  const header = JSON.stringify({ issueCount })
  const lines = nodes.map((node) =>
    JSON.stringify({
      repository: node.repository.nameWithOwner,
      number: node.number,
      createdAt: node.createdAt,
      mergedAt: node.mergedAt,
      reviews: (node.reviews?.nodes ?? []).map((review) => review.submittedAt),
    })
  )
  return [header, ...lines].join('\n')
}

/** The -f parameters of one gh call as name → value (fields repeat the flag). */
function fieldsOf(args: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  args.forEach((arg, i) => {
    if (arg === '-f') {
      const [name, ...rest] = args[i + 1].split('=')
      fields[name] = rest.join('=')
    }
  })
  return fields
}

/** Answers gh: the viewer is alice, and each graphql call is routed by a marker in its search. */
function mockContributions(replies: Record<string, string | Error>) {
  mockExecFile.mockImplementation(
    stubAnswering(({ args }) => {
      if (args[0] === 'api' && args[1] === 'user') return 'alice'
      if (args[0] === 'api' && args[1] === 'graphql') {
        const search = fieldsOf(args).search ?? ''
        for (const [mark, reply] of Object.entries(replies)) {
          if (search.includes(mark)) return reply
        }
        return new Error(`no reply queued for ${search}`)
      }
      return new Error('no reply queued')
    })
  )
}

/** The three searches, each returning `opened`, `merged`, `reviewed` nodes in order. */
function mockSearches(opened: SearchNode[], merged: SearchNode[], reviewed: SearchNode[]) {
  mockContributions({
    'author:alice created:': searchReply(opened),
    'is:merged': searchReply(merged),
    'reviewed-by:': searchReply(reviewed),
  })
}

/** An opened-PR node of `repo` created at `createdAt`. */
function openedNode(number: number, createdAt: string, repo = 'acme/widgets'): SearchNode {
  return { repository: { nameWithOwner: repo }, number, createdAt }
}

interface ContributionsReply {
  calendar: { weeks: Array<Array<{ date: string; total: number }>>; total: number }
  period: { opened: number; merged: number; reviewed: number; total: number }
  previous: { opened: number; merged: number; reviewed: number; total: number }
  repos: string[]
  fetchedAt: string
  error?: string
}

const PAYLOAD = { from: '2026-10-12', to: '2026-10-16' }

beforeEach(() => {
  vi.clearAllMocks()
  mockExecFile.mockImplementation(() => {
    throw new Error('no reply queued')
  })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T15:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const invoke = (handlers: Record<string, Handler>, payload: object = PAYLOAD) =>
  handlers['github:contributions'](payload) as Promise<ContributionsReply>

describe('github:contributions — counts a merged pull request at mergedAt, not createdAt', () => {
  it('counts a merged pull request at mergedAt, not createdAt', async () => {
    const handlers = captureHandlers()
    mockSearches(
      [],
      [
        {
          repository: { nameWithOwner: 'acme/widgets' },
          number: 7,
          createdAt: '2026-10-01T09:00:00Z',
          mergedAt: '2026-10-15T14:00:00Z',
        },
      ],
      []
    )
    const result = await invoke(handlers)
    expect(result.period).toEqual({ opened: 0, merged: 1, reviewed: 0, total: 1 })
  })
})

describe('github:contributions — counts each submitted review once and drops a pending one', () => {
  it('counts each submitted review once and drops a pending (null submittedAt) review', async () => {
    const handlers = captureHandlers()
    mockSearches(
      [],
      [],
      [
        {
          repository: { nameWithOwner: 'acme/widgets' },
          number: 9,
          reviews: {
            nodes: [
              { submittedAt: '2026-10-13T10:00:00Z' }, // a comment-only review
              { submittedAt: '2026-10-14T10:00:00Z' }, // an approval
              { submittedAt: null }, // pending
            ],
          },
        },
      ]
    )
    const result = await invoke(handlers)
    expect(result.period).toEqual({ opened: 0, merged: 0, reviewed: 2, total: 2 })
  })
})

describe('github:contributions — narrows calendar and periods to `repo`, `repos` lists all', () => {
  it('narrows calendar, period and previous to `repo`, while `repos` lists every repository', async () => {
    const handlers = captureHandlers()
    mockSearches(
      [
        openedNode(1, '2026-10-13T10:00:00Z'),
        openedNode(2, '2026-10-14T10:00:00Z', 'acme/gadgets'),
      ],
      [],
      []
    )
    const result = await invoke(handlers, { ...PAYLOAD, repo: 'acme/widgets' })
    expect(result.period).toEqual({ opened: 1, merged: 0, reviewed: 0, total: 1 })
    expect(result.repos).toEqual(['acme/gadgets', 'acme/widgets'])
    expect(result.calendar.total).toBe(1)
  })
})

describe('github:contributions — counts the previous period from the same fetch', () => {
  it('counts the previous period from the same fetch', async () => {
    const handlers = captureHandlers()
    mockSearches(
      [
        openedNode(1, '2026-10-08T10:00:00Z'), // the previous range, 2026-10-07..2026-10-11
        openedNode(2, '2026-10-13T10:00:00Z'),
      ],
      [],
      []
    )
    const result = await invoke(handlers)
    expect(result.period).toEqual({ opened: 1, merged: 0, reviewed: 0, total: 1 })
    expect(result.previous).toEqual({ opened: 1, merged: 0, reviewed: 0, total: 1 })
  })
})

describe('github:contributions — splits a search past 1000 results and de-duplicates', () => {
  it('splits a search whose issueCount passes 1000 into halves and de-duplicates the overlap', async () => {
    const handlers = captureHandlers()
    const prs = [openedNode(1, '2026-06-01T10:00:00Z'), openedNode(2, '2026-08-01T10:00:00Z')]
    mockContributions({
      'is:merged': searchReply([]),
      'reviewed-by:': searchReply([]),
      'created:2025-10-12..2026-04-14': searchReply([prs[0]], 600),
      'created:2026-04-15..2026-10-16': searchReply(prs, 700),
      'author:alice created:': searchReply([], 1500), // over the cap: the two halves above run
    })
    const result = await invoke(handlers)
    // PR 2 appears in both halves; it must count once.
    expect(result.repos).toEqual(['acme/widgets'])
    expect(result.calendar.total).toBe(2)
  })
})

describe('github:contributions — starts each search a day early for GitHub, which reads dates in UTC', () => {
  it('searches from the day before the calendar starts, so a late-evening local PR is found', async () => {
    const handlers = captureHandlers()
    // 02:55 UTC on 13 Oct is 22:55 on 12 Oct in New York: GitHub files it under the 13th.
    mockSearches([openedNode(1, '2025-10-13T02:55:00Z')], [], [])
    await invoke(handlers, { ...PAYLOAD })
    const searches = mockExecFile.mock.calls
      .map((call) => fieldsOf(call[1] as string[]).search)
      .filter(Boolean)
    expect(searches).toHaveLength(3)
    expect(searches.every((search) => search.includes('2025-10-12..2026-10-16'))).toBe(true)
  })
})

describe('github:contributions — stops splitting a one-day search that is still over the cap', () => {
  it('answers the nodes it has instead of searching the same day again', async () => {
    const handlers = captureHandlers()
    mockContributions({
      'is:merged': searchReply([]),
      'reviewed-by:': searchReply([]),
      'author:alice created:2026-10-16..2026-10-16': searchReply([], 1500),
    })
    const payload = { from: '2026-10-16', to: '2026-10-16' }
    await expect(invoke(handlers, payload)).resolves.toBeDefined()
  })
})

describe('github:contributions — answers NOT_AUTHENTICATED when gh is not signed in', () => {
  it('answers NOT_AUTHENTICATED when gh is not signed in', async () => {
    const handlers = captureHandlers()
    mockContributions({ 'author:alice created:': new Error('You need to run: gh auth login') })
    const result = await invoke(handlers)
    expect(result.error).toBe('NOT_AUTHENTICATED')
  })
})

describe('github:contributions — fails the call when one search fails', () => {
  it('answers the failure of one search, rather than a partial calendar', async () => {
    const handlers = captureHandlers()
    mockContributions({
      'author:alice created:': searchReply([]),
      'is:merged': new Error('gh: HTTP 502'),
      'reviewed-by:': searchReply([]),
    })
    const result = await invoke(handlers)
    expect(result.error).toContain('HTTP 502')
  })
})

describe('github:contributions — caches the fetch until a refresh', () => {
  it('asks gh once for a second call with the same range, and again on refresh', async () => {
    const handlers = captureHandlers()
    mockSearches([], [], [])
    await invoke(handlers)
    await invoke(handlers)
    const graphqlCalls = () =>
      mockExecFile.mock.calls.filter((c) => (c[1] as string[])[1] === 'graphql')
    expect(graphqlCalls()).toHaveLength(3)
    await invoke(handlers, { ...PAYLOAD, refresh: true })
    expect(graphqlCalls()).toHaveLength(6)
  })
})

describe('github:contributions — the payload schema', () => {
  it('rejects a payload whose dates are not YYYY-MM-DD', async () => {
    const handlers = captureHandlers()
    const result = (await handlers['github:contributions']({
      from: 'last week',
      to: '2026-10-16',
    })) as { error: string }
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})

describe('github:contributions — parses the line-delimited pages gh --jq prints', () => {
  it('parses the line-delimited JSON objects the jq filter prints per page', async () => {
    const handlers = captureHandlers()
    mockSearches([openedNode(3, '2026-10-13T10:00:00Z')], [], [])
    const result = await invoke(handlers)
    expect(result.period.opened).toBe(1)
  })
})

describe('github:contributions — hands Home the calendar', () => {
  it('hands over the all-repositories calendar after a fetch', async () => {
    const onContributions = vi.fn()
    const handlers = captureHandlers({ onContributions })
    mockSearches([openedNode(1, '2026-10-15T09:00:00Z')], [], [])
    await invoke(handlers)
    expect(onContributions).toHaveBeenCalledTimes(1)
    expect(onContributions.mock.calls[0][0].total).toBe(1)
  })

  it('hands over nothing for a calendar narrowed to one repository', async () => {
    const onContributions = vi.fn()
    const handlers = captureHandlers({ onContributions })
    mockSearches([openedNode(1, '2026-10-15T09:00:00Z')], [], [])
    await invoke(handlers, { ...PAYLOAD, repo: 'acme/widgets' })
    expect(onContributions).not.toHaveBeenCalled()
  })
})
