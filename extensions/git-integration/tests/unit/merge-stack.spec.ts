import { describe, it, expect, vi } from 'vitest'
import {
  mergeStack,
  revertPullRequest,
  stackOf,
  withoutAgentCredits,
  type StackClock,
  type StackPullRequest,
} from '../../src/ipc/github/merge-stack'
import type { GithubContext } from '../../src/ipc/github/context'

const pr = (number: number, headRefName: string, baseRefName: string): StackPullRequest => ({
  number,
  title: `PR ${number}`,
  headRefName,
  baseRefName,
  headRefOid: `sha${number}`,
})

const STACK = [pr(1, 'feat/a', 'main'), pr(2, 'feat/b', 'feat/a'), pr(3, 'other', 'main')]
const NO_WAIT: StackClock = {
  sleep: vi.fn().mockResolvedValue(undefined),
  pollMs: 3000,
  timeoutMs: 9000,
}

const AT_2 = { repoRoot: '/repo', number: 2 }

interface Calls {
  api: Array<{ path: string; method?: string; body?: unknown }>
  views: string[]
}

type ApiRequest = { path: string; method?: string; body?: unknown }

/** gh api, recording each request; the merge of `failMerge` is refused. */
function fakeApi(calls: Calls, failMerge?: number) {
  return async (_root: string, request: ApiRequest) => {
    calls.api.push(request)
    if (request.path.endsWith(`/pulls/${failMerge}/merge`)) {
      throw new Error('Head branch was modified.\nmore detail')
    }
    if (request.path.endsWith('/commits')) {
      return JSON.stringify(['Add a\n\nCo-Authored-By: Claude <c@x>\nCo-authored-by: Ana <a@x>'])
    }
    if (request.path === 'graphql') return '{"number":9,"url":"https://github.com/o/r/pull/9"}'
    return ''
  }
}

/** A context whose GitHub answers `list` with `open`, and each mergeable lookup in turn. */
function fakeContext(options: {
  open?: StackPullRequest[]
  mergeable?: string[]
  failMerge?: number
  strip?: boolean
}) {
  const calls: Calls = { api: [], views: [] }
  const mergeable = [...(options.mergeable ?? ['MERGEABLE'])]
  const ctx = {
    options: { stripAgentCredits: () => options.strip === true },
    target: (cwd: string) => ({ cwd }),
    ownerAndName: async () => ({ owner: 'o', repo: 'r' }),
    github: {
      pullRequests: {
        list: async () => options.open ?? STACK,
        view: async (_t: unknown, n: number, fields: string[]) => {
          calls.views.push(`${n}:${fields.join(',')}`)
          return fields[0] === 'id'
            ? { id: `PR_node_${n}` }
            : { mergeable: mergeable.shift() ?? 'MERGEABLE' }
        },
      },
    },
    api: fakeApi(calls, options.failMerge),
  } as unknown as GithubContext
  return { ctx, calls }
}

describe('stackOf', () => {
  it('walks the base branches down to the one no open pull request owns, bottom first', () => {
    expect(stackOf(STACK, 2).map((p) => p.number)).toEqual([1, 2])
    expect(stackOf(STACK, 1).map((p) => p.number)).toEqual([1])
    expect(stackOf(STACK, 3).map((p) => p.number)).toEqual([3])
  })

  it('never stacks on a pull request from a fork, whatever its branch is named', () => {
    const fork = { ...pr(7, 'main', 'main'), isCrossRepository: true }
    expect(stackOf([fork, pr(1, 'feat/a', 'main')], 1).map((p) => p.number)).toEqual([1])
  })

  it('returns nothing for a pull request that is not open, and stops on a loop', () => {
    expect(stackOf(STACK, 9)).toEqual([])
    expect(stackOf([pr(1, 'a', 'b'), pr(2, 'b', 'a')], 1)).toHaveLength(2)
  })
})

describe('withoutAgentCredits', () => {
  it('drops Co-Authored-By lines of known agents in any case and keeps people', () => {
    const message = [
      'Fix',
      'Co-Authored-By: Claude Sonnet <noreply@anthropic.com>',
      'co-authored-by: GitHub Copilot <c@github.com>',
      'Co-authored-by: CODEX <x@y>',
      'Co-Authored-By: Gemini <g@g>',
      'Co-Authored-By: Cursor Agent <c@c>',
      'Co-Authored-By: Ana <ana@x.com>',
      'Mentions Claude in prose',
    ].join('\n')
    expect(withoutAgentCredits(message)).toBe(
      'Fix\nCo-Authored-By: Ana <ana@x.com>\nMentions Claude in prose'
    )
  })
})

describe('mergeStack', () => {
  it('merges the bottom, retargets the next onto main, waits for GitHub, then merges it', async () => {
    const { ctx, calls } = fakeContext({ mergeable: ['UNKNOWN', 'MERGEABLE'] })
    const result = await mergeStack(ctx, AT_2, NO_WAIT)
    expect(result).toEqual({ merged: [1, 2] })
    expect(calls.api.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT repos/o/r/pulls/1/merge',
      'PATCH repos/o/r/pulls/2',
      'PUT repos/o/r/pulls/2/merge',
    ])
    expect(calls.api[0].body).toEqual({ merge_method: 'squash', sha: 'sha1' })
    expect(calls.api[1].body).toEqual({ base: 'main' })
    expect(calls.views).toEqual(['2:mergeable', '2:mergeable'])
    expect(NO_WAIT.sleep).toHaveBeenCalledWith(3000)
  })

  it('stops at a failure on the bottom and leaves the rest open, with the reason', async () => {
    const { ctx, calls } = fakeContext({ failMerge: 1 })
    const result = await mergeStack(ctx, AT_2, NO_WAIT)
    expect(result).toEqual({
      merged: [],
      failed: { number: 1, reason: 'Head branch was modified.' },
    })
    expect(calls.api.some((c) => c.method === 'PATCH')).toBe(false)
  })
})

describe('mergeStack — when it stops', () => {
  it('stops when the retargeted pull request conflicts', async () => {
    const { ctx, calls } = fakeContext({ mergeable: ['CONFLICTING'] })
    const result = await mergeStack(ctx, AT_2, NO_WAIT)
    expect(result).toEqual({
      merged: [1],
      failed: { number: 2, reason: '#2 has conflicts with main' },
    })
    expect(calls.api.filter((c) => c.method === 'PUT')).toHaveLength(1)
  })

  it('gives up when GitHub stays UNKNOWN past the timeout', async () => {
    const { ctx } = fakeContext({ mergeable: Array(20).fill('UNKNOWN') })
    const result = await mergeStack(ctx, AT_2, NO_WAIT)
    expect(result.failed).toEqual({
      number: 2,
      reason: 'GitHub did not finish checking #2 within a minute',
    })
  })

  it('sends the squash message without agent credits when the setting is on', async () => {
    const { ctx, calls } = fakeContext({ strip: true, open: [STACK[0]] })
    await mergeStack(ctx, { repoRoot: '/repo', number: 1 }, NO_WAIT)
    const merge = calls.api.find((c) => c.method === 'PUT')
    expect(merge?.body).toEqual({
      merge_method: 'squash',
      sha: 'sha1',
      commit_message: 'Co-authored-by: Ana <a@x>',
    })
  })
})

describe('revertPullRequest', () => {
  it('asks GitHub to revert by node id and returns the new pull request', async () => {
    const { ctx, calls } = fakeContext({})
    expect(await revertPullRequest(ctx, '/repo', 7)).toEqual({
      number: 9,
      url: 'https://github.com/o/r/pull/9',
    })
    expect(calls.views).toEqual(['7:id'])
    expect(calls.api[0]).toMatchObject({ path: 'graphql', fields: { id: 'PR_node_7' } })
  })
})
