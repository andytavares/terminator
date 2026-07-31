import { describe, it, expect } from 'vitest'
import { createReviewQueue } from '../../../src/runtime/review/review-queue.js'
import { reviewIntent } from '../../../src/runtime/review/intent-diff.js'

function candidate(over: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    repoPath: '/repo',
    branch: 'feat/x',
    diffSummary: { files: 2, added: 10, removed: 3 },
    change: {
      files: ['src/widgets/list.ts'],
      linesChanged: 13,
      checkState: 'passing' as const,
      sharedContractFiles: [],
      criticalPaths: [],
    },
    queuedAt: 1_000,
    ...over,
  }
}

describe('enqueueing (FR-045)', () => {
  it('queues a session that produced changes', () => {
    const queue = createReviewQueue()
    expect(queue.enqueue(candidate())).not.toBeNull()
    expect(queue.count()).toBe(1)
  })

  it('refuses a session that changed nothing — there is nothing to review', () => {
    const queue = createReviewQueue()
    expect(queue.enqueue(candidate({ diffSummary: { files: 0, added: 0, removed: 0 } }))).toBeNull()
    expect(queue.count()).toBe(0)
  })

  it('starts every item at the intent step (FR-051)', () => {
    const queue = createReviewQueue()
    expect(queue.enqueue(candidate())?.step).toBe('intent')
  })

  it('carries the grade and its specific trigger (FR-050)', () => {
    const queue = createReviewQueue()
    const item = queue.enqueue(
      candidate({
        change: {
          files: ['src/auth/login.ts'],
          linesChanged: 5,
          checkState: 'passing',
          sharedContractFiles: [],
          criticalPaths: [],
        },
      })
    )
    expect(item?.grade).toBe('P0')
    expect(item?.gradeTrigger).toContain('src/auth/login.ts')
  })
})

describe('ordering worst-first (FR-046)', () => {
  const withFiles = (sessionId: string, files: string[], queuedAt: number) =>
    candidate({
      sessionId,
      queuedAt,
      change: {
        files,
        linesChanged: 10,
        checkState: 'passing' as const,
        sharedContractFiles: [],
        criticalPaths: [],
      },
    })

  it('orders P0 before P1 before P2 before P3, regardless of arrival', () => {
    const queue = createReviewQueue()
    queue.enqueue(withFiles('p3', ['package-lock.json'], 1_000))
    queue.enqueue(withFiles('p2', ['src/widgets/a.ts'], 2_000))
    queue.enqueue(withFiles('p1', ['src/shared/schemas/a.schema.ts'], 3_000))
    queue.enqueue(withFiles('p0', ['src/auth/a.ts'], 4_000))
    expect(queue.list().map((i) => i.sessionId)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('orders oldest first within the same grade', () => {
    const queue = createReviewQueue()
    queue.enqueue(withFiles('newer', ['src/a.ts'], 9_000))
    queue.enqueue(withFiles('older', ['src/b.ts'], 1_000))
    expect(queue.list().map((i) => i.sessionId)).toEqual(['older', 'newer'])
  })

  it('is empty to start with', () => {
    expect(createReviewQueue().list()).toEqual([])
  })
})

describe('the four-step flow (FR-051)', () => {
  it('advances intent to risk to structure to tests', () => {
    const queue = createReviewQueue()
    queue.enqueue(candidate())
    expect(queue.advance('s1')).toBe('risk')
    expect(queue.advance('s1')).toBe('structure')
    expect(queue.advance('s1')).toBe('tests')
  })

  it('does not wrap around past the last step', () => {
    const queue = createReviewQueue()
    queue.enqueue(candidate())
    queue.advance('s1')
    queue.advance('s1')
    queue.advance('s1')
    expect(queue.advance('s1')).toBeNull()
  })

  it('returns null for a session not in the queue', () => {
    expect(createReviewQueue().advance('nope')).toBeNull()
  })
})

describe('removal', () => {
  it('removes a reviewed session, freeing a backpressure slot', () => {
    const queue = createReviewQueue()
    queue.enqueue(candidate())
    queue.remove('s1')
    expect(queue.count()).toBe(0)
  })

  it('is a no-op for an unknown session', () => {
    expect(() => createReviewQueue().remove('nope')).not.toThrow()
  })
})

describe('intent review (FR-051)', () => {
  const base = {
    request: 'Add ULID session ids',
    agentAccount: 'Added ULID generation and updated the session schema',
  }

  it('flags a file the request never anticipated — the scope-creep signal', () => {
    const review = reviewIntent({
      ...base,
      changedFiles: ['src/session/id.ts', 'src/config/timeouts.ts'],
      expectedFiles: ['src/session/id.ts'],
    })
    // The "also shortened the idle timeout" class of change.
    expect(review.unexpectedFiles).toEqual(['src/config/timeouts.ts'])
    expect(review.hasScopeConcern).toBe(true)
  })

  it('flags an expected file that was never touched', () => {
    const review = reviewIntent({
      ...base,
      changedFiles: ['src/session/id.ts'],
      expectedFiles: ['src/session/id.ts', 'src/session/store.ts'],
    })
    expect(review.untouchedFiles).toEqual(['src/session/store.ts'])
    expect(review.hasScopeConcern).toBe(true)
  })

  it('raises no concern when the change matches the request exactly', () => {
    const review = reviewIntent({
      ...base,
      changedFiles: ['src/session/id.ts'],
      expectedFiles: ['src/session/id.ts'],
    })
    expect(review).toMatchObject({
      hasScopeConcern: false,
      unexpectedFiles: [],
      untouchedFiles: [],
    })
  })

  it('flags nothing when the request declared no files, rather than flagging everything', () => {
    // Ad-hoc work has no declared scope. Marking every file unexpected would be
    // noise that trains the operator to skip the step this exists to enforce.
    const review = reviewIntent({
      ...base,
      changedFiles: ['a.ts', 'b.ts'],
      expectedFiles: [],
    })
    expect(review).toMatchObject({ hasScopeConcern: false, unexpectedFiles: [] })
  })

  it('keeps both the request and the agent account for side-by-side reading', () => {
    const review = reviewIntent({ ...base, changedFiles: [], expectedFiles: [] })
    expect(review.request).toBe(base.request)
    expect(review.agentAccount).toBe(base.agentAccount)
  })
})
