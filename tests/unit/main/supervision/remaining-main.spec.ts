import { describe, it, expect } from 'vitest'
import { createDecisionSet } from '../../../../src/main/supervision/review/hunk-decisions.js'
import {
  intakeFromUrl,
  intakeFromDocument,
} from '../../../../src/main/supervision/workitems/intake.js'
import {
  channelFor,
  buildDigest,
  allClearMessage,
} from '../../../../src/main/supervision/feed/digest.js'
import type { FeedEntry } from '../../../../src/main/supervision/feed/feed-log.js'

const hunks = [
  { id: 'h1', file: 'src/a.ts', newStart: 10, lines: ['+ the change you asked for'] },
  { id: 'h2', file: 'src/a.ts', newStart: 40, lines: ['+ the one you did not'] },
  { id: 'h3', file: 'src/b.ts', newStart: 1, lines: ['+ another'] },
]

describe('per-hunk decisions (FR-052)', () => {
  it('retains only accepted hunks, including within one file', () => {
    const set = createDecisionSet(hunks)
    set.decide('h1', 'accept')
    set.decide('h2', 'reject')
    set.decide('h3', 'accept')
    expect(set.acceptedHunks().map((h) => h.id)).toEqual(['h1', 'h3'])
  })

  it('reports decisions grouped by file', () => {
    const set = createDecisionSet(hunks)
    set.decide('h1', 'accept')
    set.decide('h2', 'reject')
    expect(set.byFile()[0]).toMatchObject({ file: 'src/a.ts', accepted: ['h1'], rejected: ['h2'] })
  })

  it('reports a hunk with no decision yet', () => {
    expect(createDecisionSet(hunks).decisionFor('h1')).toBeNull()
  })

  it('allows a decision to be changed', () => {
    const set = createDecisionSet(hunks)
    set.decide('h1', 'accept')
    set.decide('h1', 'reject')
    expect(set.decisionFor('h1')).toBe('reject')
  })

  it('ignores a decision about a hunk that is not in the diff', () => {
    const set = createDecisionSet(hunks)
    set.decide('not-a-hunk', 'accept')
    expect(set.acceptedHunks()).toEqual([])
  })

  it('knows when every hunk has been decided', () => {
    const set = createDecisionSet(hunks)
    expect(set.isComplete()).toBe(false)
    for (const h of hunks) set.decide(h.id, 'accept')
    expect(set.isComplete()).toBe(true)
  })

  it('detects a full reject, which discards rather than merges (spec Edge Cases)', () => {
    const set = createDecisionSet(hunks)
    for (const h of hunks) set.decide(h.id, 'reject')
    expect(set.isFullReject()).toBe(true)
  })

  it('does not call an undecided review a full reject', () => {
    expect(createDecisionSet(hunks).isFullReject()).toBe(false)
  })

  it('does not call an empty diff a full reject', () => {
    expect(createDecisionSet([]).isFullReject()).toBe(false)
  })
})

describe('intake (FR-068, FR-069)', () => {
  it('reads a Linear issue URL', () => {
    const result = intakeFromUrl('https://linear.app/team/issue/FLU-220/unify-ids', 1_000)
    expect(result.ok && result.stub).toMatchObject({ id: 'FLU-220', source: 'linear' })
  })

  it('reads a GitHub issue URL', () => {
    const result = intakeFromUrl('https://github.com/acme/widgets/issues/42', 1_000)
    expect(result.ok && result.stub).toMatchObject({ id: 'acme/widgets#42', source: 'github' })
  })

  it('reads a GitHub pull request URL', () => {
    const result = intakeFromUrl('https://github.com/acme/widgets/pull/7', 1_000)
    expect(result.ok && result.stub.id).toBe('acme/widgets#7')
  })

  it('rejects a URL it does not recognise', () => {
    expect(intakeFromUrl('https://example.com/thing', 1_000)).toMatchObject({ ok: false })
  })

  it('retains the source link', () => {
    const url = 'https://linear.app/team/issue/FLU-220/x'
    expect(intakeFromUrl(url, 1_000).ok && intakeFromUrl(url, 1_000).stub.sourceUrl).toBe(url)
  })

  it('titles a local document from its first heading', () => {
    const result = intakeFromDocument('/docs/idea.md', '# Unify session identity\n\nbody', 1_000)
    expect(result.ok && result.stub.title).toBe('Unify session identity')
  })

  it('falls back to the first non-blank line when there is no heading', () => {
    const result = intakeFromDocument('/docs/idea.md', '\n\nJust a line\nmore', 1_000)
    expect(result.ok && result.stub.title).toBe('Just a line')
  })

  it('rejects a document type it cannot read', () => {
    expect(intakeFromDocument('/docs/thing.pdf', 'x', 1_000)).toMatchObject({ ok: false })
  })

  it('always lands in the intake phase — nothing auto-starts (FR-069)', () => {
    const fromUrl = intakeFromUrl('https://linear.app/t/issue/FLU-1/x', 1_000)
    const fromDoc = intakeFromDocument('/a.md', '# T', 1_000)
    expect(fromUrl.ok && fromUrl.stub.phase).toBe('intake')
    expect(fromDoc.ok && fromDoc.stub.phase).toBe('intake')
  })
})

describe('notification discipline (FR-023, FR-028)', () => {
  it('reserves the modal for a blocking permission request', () => {
    expect(channelFor({ kind: 'permission_requested', sessionId: 's1' })).toBe('modal')
  })

  it.each(['stalled', 'failed', 'ready'] as const)(
    'uses a non-blocking indicator for %s',
    (kind) => {
      expect(channelFor({ kind, sessionId: 's1' })).toBe('indicator')
    }
  )

  it('defers routine progress to the digest rather than interrupting', () => {
    expect(channelFor({ kind: 'progress', sessionId: 's1' })).toBe('digest')
  })
})

describe('digest', () => {
  const entry = (at: number, sessionId: string): FeedEntry => ({
    id: `${sessionId}-${at}`,
    at,
    sessionId,
    author: 'agent',
    summary: 'did a thing',
    replyable: true,
  })

  it('batches an interval into one thing to read', () => {
    const digest = buildDigest([entry(1_000, 'a'), entry(2_000, 'b')], 0, 5_000)
    expect(digest).toMatchObject({ entryCount: 2, sessionCount: 2 })
  })

  it('excludes entries outside the window', () => {
    expect(buildDigest([entry(1_000, 'a'), entry(9_000, 'a')], 0, 5_000).entryCount).toBe(1)
  })

  it('groups by session', () => {
    const digest = buildDigest([entry(1_000, 'a'), entry(2_000, 'a')], 0, 5_000)
    expect(digest.bySession[0].entries).toHaveLength(2)
  })

  it('handles an empty window without dividing by zero', () => {
    expect(buildDigest([], 0, 5_000)).toMatchObject({ entryCount: 0, sessionCount: 0 })
  })
})

describe('the all-clear (FR-024)', () => {
  it('asserts everything is fine rather than leaving the surface blank', () => {
    // Silence is what a crashed console also looks like, so the UI has to say it.
    expect(allClearMessage(0, 3)).toContain('Nothing needs you')
    expect(allClearMessage(0, 3)).toContain('3 sessions are working')
  })

  it('says so when nothing is running either', () => {
    expect(allClearMessage(0, 0)).toContain('nothing is running')
  })

  it('uses the singular for one session', () => {
    expect(allClearMessage(0, 1)).toContain('1 session is working')
  })

  it('says nothing when something does need attention', () => {
    expect(allClearMessage(2, 3)).toBeNull()
  })
})
