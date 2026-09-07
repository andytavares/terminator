import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkCapability,
  writeBack,
  INTENT_FOR_EVENT,
  MAX_ATTEMPTS,
} from '../../src/trackers/write-back.js'
import type { IssuesPort, WriteBackDeps } from '../../src/trackers/write-back.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder, WriteBack } from '../../src/order/schema.js'

// Three writes back to the issue that started the work, and one rule over all
// of them: a tracker write never affects the work (FR-063).
//
// The distinction the whole file turns on is failed versus unsupported. A
// failure is retried; a capability the tracker does not have is recorded once
// and never asked about again — retrying it forever is how a log becomes
// unreadable.

let record: ReturnType<typeof vi.fn>

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: {
      kind: 'tracker',
      tracker: 'linear',
      key: 'TAV-42',
      url: 'https://linear.app/tav/issue/TAV-42',
    },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    writeBack: ['summary_comment', 'status', 'pr_link'] as WriteBack[],
    ...over,
  }
}

function port(over: Partial<IssuesPort> = {}): IssuesPort {
  return {
    comment: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
    states: vi.fn(async () => [
      { id: 'st-progress', name: 'In Progress', intent: 'started' as const, available: true },
      { id: 'st-review', name: 'In Review', intent: 'in_review' as const, available: true },
      { id: 'st-done', name: 'Done', intent: 'done' as const, available: true },
    ]),
    supportsTransitions: vi.fn(() => true),
    ...over,
  }
}

function deps(over: Partial<WriteBackDeps> = {}): WriteBackDeps {
  return { issues: port(), record: record as never, now: () => '2026-09-06T12:00:00.000Z', ...over }
}

beforeEach(() => {
  record = vi.fn(async () => undefined)
})

describe('the capability check happens at agreement (FR-059a)', () => {
  it('reports state write-back as supported for a tracker that supports it', async () => {
    const report = await checkCapability(order(), deps())
    expect(report.transitions).toBe('supported')
  })

  it('reports it as unsupported for a tracker that does not', async () => {
    const issues = port({ supportsTransitions: vi.fn(() => false) })
    const report = await checkCapability(order(), deps({ issues }))
    expect(report.transitions).toBe('unsupported')
  })

  it('records the unsupported capability once, at agreement, not at write time', async () => {
    const issues = port({ supportsTransitions: vi.fn(() => false) })
    await checkCapability(order(), deps({ issues }))
    expect(record).toHaveBeenCalledWith(
      'writeback.unsupported',
      'linear',
      expect.stringContaining('state')
    )
  })

  it('records nothing when the capability is there', async () => {
    await checkCapability(order(), deps())
    expect(record).not.toHaveBeenCalled()
  })

  it('reports the candidate states so the operator can adjust the mapping (FR-060)', async () => {
    const report = await checkCapability(order(), deps())
    expect(report.states.map((s) => s.id)).toEqual(['st-progress', 'st-review', 'st-done'])
  })

  it('reads no states for a tracker that cannot be moved', async () => {
    const issues = port({ supportsTransitions: vi.fn(() => false) })
    const report = await checkCapability(order(), deps({ issues }))
    expect(report.states).toEqual([])
    expect(issues.states).not.toHaveBeenCalled()
  })

  it('says which intents this workflow has nowhere to go for', async () => {
    const issues = port({
      states: vi.fn(async () => [
        { id: 'st-progress', name: 'Doing', intent: 'started' as const, available: true },
        { id: 'st-done', name: 'Done', intent: 'done' as const, available: true },
      ]),
    })
    const report = await checkCapability(order(), deps({ issues }))
    expect(report.unreachable).toEqual(['in_review'])
  })

  it('is a no-op for an order with no source issue', async () => {
    const typed = order({ source: { kind: 'typed', tracker: null, key: null, url: null } })
    const report = await checkCapability(typed, deps())
    expect(report.transitions).toBe('no_issue')
    expect(record).not.toHaveBeenCalled()
  })

  it('reads the state list even when the tracker cannot answer, without failing agreement', async () => {
    const issues = port({ states: vi.fn(async () => Promise.reject(new Error('offline'))) })
    const report = await checkCapability(order(), deps({ issues }))
    expect(report.states).toEqual([])
    expect(report.transitions).toBe('supported')
  })
})

describe('the summary comment (FR-058)', () => {
  it('writes the rendered order to the issue on agreement', async () => {
    const issues = port()
    await writeBack(order(), 'agreed', deps({ issues }))
    expect(issues.comment).toHaveBeenCalledWith(
      'linear',
      'TAV-42',
      expect.stringContaining('Refuse an expired refresh token')
    )
  })

  it('writes it again on an amendment', async () => {
    const issues = port()
    await writeBack(order(), 'amended', deps({ issues }))
    expect(issues.comment).toHaveBeenCalledTimes(1)
  })

  it('does not write it when the order has that write turned off (FR-062)', async () => {
    const issues = port()
    await writeBack(order({ writeBack: ['status'] }), 'agreed', deps({ issues }))
    expect(issues.comment).not.toHaveBeenCalled()
  })
})

describe('the state move (FR-059)', () => {
  it('maps each event to the intent it means', () => {
    expect(INTENT_FOR_EVENT.started).toBe('started')
    expect(INTENT_FOR_EVENT.draft_opened).toBe('in_review')
    expect(INTENT_FOR_EVENT.merged).toBe('done')
    expect(INTENT_FOR_EVENT.agreed).toBeNull()
  })

  it('moves the issue when work starts', async () => {
    const issues = port()
    await writeBack(order(), 'started', deps({ issues }))
    expect(issues.transition).toHaveBeenCalledWith('linear', 'TAV-42', 'started', undefined)
  })

  it("passes the operator's own mapping when they set one", async () => {
    const issues = port()
    await writeBack(
      order(),
      'draft_opened',
      deps({ issues, mapping: { in_review: 'st-progress' } })
    )
    expect(issues.transition).toHaveBeenCalledWith('linear', 'TAV-42', 'in_review', 'st-progress')
  })

  it('never moves an issue on a tracker that cannot be moved, and never comments that it did', async () => {
    const issues = port({ supportsTransitions: vi.fn(() => false) })
    const results = await writeBack(order(), 'started', deps({ issues }))
    expect(issues.transition).not.toHaveBeenCalled()
    expect(issues.comment).not.toHaveBeenCalled()
    expect(results.some((r) => r.unsupported)).toBe(true)
  })

  it('records an unsupported move once and does not retry it', async () => {
    const issues = port({ supportsTransitions: vi.fn(() => false) })
    await writeBack(order(), 'started', deps({ issues }))
    const unsupported = record.mock.calls.filter((c) => c[0] === 'writeback.unsupported')
    expect(unsupported).toHaveLength(1)
  })
})

describe('the pull request link (FR-061)', () => {
  it('comments the links on the issue when a draft opens', async () => {
    const issues = port()
    await writeBack(order(), 'draft_opened', deps({ issues }), {
      pulls: [{ repo: 'app', url: 'https://github.com/tav/app/pull/7' }],
    })
    expect(issues.comment).toHaveBeenCalledWith(
      'linear',
      'TAV-42',
      expect.stringContaining('https://github.com/tav/app/pull/7')
    )
  })

  it('names each repository, so a multi-repository order reads', async () => {
    const issues = port()
    await writeBack(order(), 'draft_opened', deps({ issues }), {
      pulls: [
        { repo: 'app', url: 'https://github.com/tav/app/pull/7' },
        { repo: 'sdk', url: 'https://github.com/tav/sdk/pull/3' },
      ],
    })
    const body = (issues.comment as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
    expect(body).toContain('app')
    expect(body).toContain('sdk')
  })

  it('writes nothing when there are no links to write', async () => {
    const issues = port()
    await writeBack(order(), 'draft_opened', deps({ issues }), { pulls: [] })
    expect(issues.comment).not.toHaveBeenCalled()
  })
})

describe('a failed write never affects the work (FR-063)', () => {
  it('retries a failure', async () => {
    const comment = vi.fn(async () => Promise.reject(new Error('rate limited')))
    await writeBack(order(), 'agreed', deps({ issues: port({ comment }) }))
    expect(comment).toHaveBeenCalledTimes(MAX_ATTEMPTS)
  })

  it('records the failure rather than throwing it at the caller', async () => {
    const comment = vi.fn(async () => Promise.reject(new Error('rate limited')))
    const results = await writeBack(order(), 'agreed', deps({ issues: port({ comment }) }))
    expect(results[0].ok).toBe(false)
    expect(record).toHaveBeenCalledWith(
      'writeback.failed',
      expect.any(String),
      expect.stringContaining('rate limited')
    )
  })

  it('resolves rather than rejecting, whatever the tracker did', async () => {
    const issues = port({
      comment: vi.fn(async () => Promise.reject(new Error('boom'))),
      transition: vi.fn(async () => Promise.reject(new Error('boom'))),
    })
    await expect(writeBack(order(), 'draft_opened', deps({ issues }))).resolves.toBeInstanceOf(
      Array
    )
  })

  it('succeeds on the retry when the first attempt was a blip', async () => {
    let calls = 0
    const comment = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return undefined
    })
    const results = await writeBack(order(), 'agreed', deps({ issues: port({ comment }) }))
    expect(results[0].ok).toBe(true)
  })

  it('does not retry a write the tracker said it cannot do', async () => {
    const transition = vi.fn(async () => {
      throw Object.assign(new Error('jira cannot be asked to move an issue'), {
        kind: 'unsupported',
      })
    })
    await writeBack(order(), 'started', deps({ issues: port({ transition }) }))
    expect(transition).toHaveBeenCalledTimes(1)
  })

  it('carries on with the other writes when one of them fails', async () => {
    const issues = port({ transition: vi.fn(async () => Promise.reject(new Error('boom'))) })
    const results = await writeBack(order(), 'draft_opened', deps({ issues }), {
      pulls: [{ repo: 'app', url: 'https://github.com/tav/app/pull/7' }],
    })
    expect(results.some((r) => r.ok)).toBe(true)
    expect(issues.comment).toHaveBeenCalled()
  })
})

describe('an order with nothing to write back to', () => {
  it('writes nothing for a typed idea', async () => {
    const issues = port()
    const typed = order({ source: { kind: 'typed', tracker: null, key: null, url: null } })
    expect(await writeBack(typed, 'agreed', deps({ issues }))).toEqual([])
    expect(issues.comment).not.toHaveBeenCalled()
  })

  it('writes nothing when every write-back is turned off', async () => {
    const issues = port()
    expect(await writeBack(order({ writeBack: [] }), 'agreed', deps({ issues }))).toEqual([])
    expect(issues.comment).not.toHaveBeenCalled()
  })
})
