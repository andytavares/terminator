import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { wrapDb } from '../../../../src/main/db/index'
import { applyTaskVaultSchema } from '../../src/vault/db'
import type { ExtensionDB } from '../../../../src/main/db/index'
import {
  completeReview,
  formatReviewMarkdown,
  getReview,
  lastCompletedReviewDate,
  listReviews,
  logReviewAction,
  startOrResumeReview,
  type WeeklyReviewDetail,
} from '../../src/vault/weekly-review-repository'

let pg: PGlite
let db: ExtensionDB

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyTaskVaultSchema(db)
})

afterEach(async () => {
  await pg.close()
})

describe('schema', () => {
  it('creates the weekly review tables', async () => {
    const rows = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    )
    const tables = rows.map((r) => r.table_name)
    expect(tables).toContain('weekly_reviews')
    expect(tables).toContain('weekly_review_actions')
  })
})

describe('startOrResumeReview', () => {
  it('creates a new in-progress review', async () => {
    const { review, resumed } = await startOrResumeReview(db, '2026-01-05T09:00:00.000Z')
    expect(resumed).toBe(false)
    expect(review.status).toBe('in_progress')
    expect(review.startedAt).toBe('2026-01-05T09:00:00.000Z')
    expect(review.completedAt).toBeNull()
  })

  it('resumes the open review instead of forking a second one', async () => {
    const first = await startOrResumeReview(db, '2026-01-05T09:00:00.000Z')
    const second = await startOrResumeReview(db, '2026-01-05T09:30:00.000Z')

    expect(second.resumed).toBe(true)
    expect(second.review.id).toBe(first.review.id)
    expect(await listReviews(db)).toHaveLength(1)
  })

  it('starts a fresh review once the previous one is completed', async () => {
    const first = await startOrResumeReview(db, '2026-01-05T09:00:00.000Z')
    await completeReview(db, { reviewId: first.review.id }, '2026-01-05T10:00:00.000Z')
    const second = await startOrResumeReview(db, '2026-01-12T09:00:00.000Z')

    expect(second.resumed).toBe(false)
    expect(second.review.id).not.toBe(first.review.id)
    expect(await listReviews(db)).toHaveLength(2)
  })
})

describe('logReviewAction', () => {
  it('records an action against the review', async () => {
    const { review } = await startOrResumeReview(db)
    await logReviewAction(db, {
      reviewId: review.id,
      step: 5,
      action: 'task-promoted',
      entityType: 'task',
      entityId: 'task-1',
      entityLabel: 'Ship the thing',
    })

    const detail = await getReview(db, review.id)
    expect(detail?.actions).toHaveLength(1)
    expect(detail?.actions[0]).toMatchObject({
      step: 5,
      action: 'task-promoted',
      entityType: 'task',
      entityId: 'task-1',
      entityLabel: 'Ship the thing',
      detail: null,
    })
  })

  it('records optional detail such as a new project status', async () => {
    const { review } = await startOrResumeReview(db)
    await logReviewAction(db, {
      reviewId: review.id,
      step: 3,
      action: 'project-status',
      entityType: 'project',
      entityLabel: 'Website rebuild',
      detail: 'archived',
    })

    const stored = await getReview(db, review.id)
    expect(stored?.actions[0].detail).toBe('archived')
  })

  it('keeps actions in the order they happened', async () => {
    const { review } = await startOrResumeReview(db)
    for (const [i, label] of ['first', 'second', 'third'].entries()) {
      await logReviewAction(
        db,
        {
          reviewId: review.id,
          step: 4,
          action: 'task-kept',
          entityType: 'task',
          entityLabel: label,
        },
        `2026-01-05T09:0${i}:00.000Z`
      )
    }

    const stored = await getReview(db, review.id)
    expect(stored?.actions.map((a) => a.entityLabel)).toEqual(['first', 'second', 'third'])
  })
})

describe('completeReview', () => {
  it('stores the reflection answers and marks the review complete', async () => {
    const { review } = await startOrResumeReview(db)
    await completeReview(
      db,
      {
        reviewId: review.id,
        worked: 'Shipping small',
        didntWork: 'Too many meetings',
        tryNext: 'Block mornings',
      },
      '2026-01-05T10:00:00.000Z'
    )

    const stored = await getReview(db, review.id)
    expect(stored).toMatchObject({
      status: 'completed',
      completedAt: '2026-01-05T10:00:00.000Z',
      worked: 'Shipping small',
      didntWork: 'Too many meetings',
      tryNext: 'Block mornings',
    })
  })

  it('stores blank answers as null rather than empty strings', async () => {
    const { review } = await startOrResumeReview(db)
    await completeReview(db, { reviewId: review.id, worked: '   ', didntWork: '' })

    const stored = await getReview(db, review.id)
    expect(stored?.worked).toBeNull()
    expect(stored?.didntWork).toBeNull()
    expect(stored?.tryNext).toBeNull()
  })
})

describe('listReviews', () => {
  it('returns nothing before any review exists', async () => {
    expect(await listReviews(db)).toEqual([])
  })

  it('returns newest first with an action count', async () => {
    const older = await startOrResumeReview(db, '2026-01-05T09:00:00.000Z')
    await logReviewAction(db, {
      reviewId: older.review.id,
      step: 1,
      action: 'captured',
      entityType: 'task',
      entityLabel: 'a thought',
    })
    await completeReview(db, { reviewId: older.review.id }, '2026-01-05T10:00:00.000Z')
    await startOrResumeReview(db, '2026-01-12T09:00:00.000Z')

    const reviews = await listReviews(db)
    expect(reviews.map((r) => r.startedAt)).toEqual([
      '2026-01-12T09:00:00.000Z',
      '2026-01-05T09:00:00.000Z',
    ])
    expect(reviews[1].actionCount).toBe(1)
    expect(reviews[0].actionCount).toBe(0)
  })

  it('honours the limit', async () => {
    for (const day of ['05', '12', '19']) {
      const { review } = await startOrResumeReview(db, `2026-01-${day}T09:00:00.000Z`)
      await completeReview(db, { reviewId: review.id })
    }
    expect(await listReviews(db, 2)).toHaveLength(2)
  })
})

describe('getReview', () => {
  it('returns null for an unknown id', async () => {
    expect(await getReview(db, 'nope')).toBeNull()
  })
})

describe('lastCompletedReviewDate', () => {
  it('is null before any review is completed', async () => {
    await startOrResumeReview(db)
    expect(await lastCompletedReviewDate(db)).toBeNull()
  })

  it('returns the most recent completion', async () => {
    const first = await startOrResumeReview(db, '2026-01-05T09:00:00.000Z')
    await completeReview(db, { reviewId: first.review.id }, '2026-01-05T10:00:00.000Z')
    const second = await startOrResumeReview(db, '2026-01-12T09:00:00.000Z')
    await completeReview(db, { reviewId: second.review.id }, '2026-01-12T10:00:00.000Z')

    expect(await lastCompletedReviewDate(db)).toBe('2026-01-12T10:00:00.000Z')
  })
})

describe('formatReviewMarkdown', () => {
  function makeDetail(overrides: Partial<WeeklyReviewDetail> = {}): WeeklyReviewDetail {
    return {
      id: 'r1',
      startedAt: '2026-01-05T09:00:00.000Z',
      completedAt: '2026-01-05T10:00:00.000Z',
      status: 'completed',
      worked: null,
      didntWork: null,
      tryNext: null,
      actions: [],
      ...overrides,
    }
  }

  function action(over: Partial<WeeklyReviewDetail['actions'][number]>) {
    return {
      id: 'a1',
      reviewId: 'r1',
      step: 1,
      action: 'captured' as const,
      entityType: 'task' as const,
      entityId: null,
      entityLabel: 'something',
      detail: null,
      createdAt: '2026-01-05T09:05:00.000Z',
      ...over,
    }
  }

  it('titles the document with the review date', () => {
    expect(formatReviewMarkdown(makeDetail())).toContain('# Weekly Review — 2026-01-05')
  })

  it('notes when a review was never completed', () => {
    const md = formatReviewMarkdown(makeDetail({ completedAt: null, status: 'in_progress' }))
    expect(md).toContain('Completed: not completed')
  })

  it('groups actions under a heading per kind', () => {
    const md = formatReviewMarkdown(
      makeDetail({
        actions: [
          action({ action: 'task-promoted', entityLabel: 'Write the spec' }),
          action({ id: 'a2', action: 'task-archived', entityLabel: 'Old idea' }),
        ],
      })
    )
    expect(md).toContain('## Promoted to today')
    expect(md).toContain('- Write the spec')
    expect(md).toContain('## Archived')
    expect(md).toContain('- Old idea')
  })

  it('appends action detail after the label', () => {
    const md = formatReviewMarkdown(
      makeDetail({
        actions: [action({ action: 'project-status', entityLabel: 'Website', detail: 'someday' })],
      })
    )
    expect(md).toContain('- Website — someday')
  })

  it('omits headings for kinds with no actions', () => {
    const md = formatReviewMarkdown(makeDetail({ actions: [action({ action: 'captured' })] }))
    expect(md).toContain('## Captured')
    expect(md).not.toContain('## Deleted')
  })

  it('includes the reflection when answers were given', () => {
    const md = formatReviewMarkdown(makeDetail({ worked: 'small PRs', tryNext: 'more of that' }))
    expect(md).toContain('## Reflection')
    expect(md).toContain('small PRs')
    expect(md).toContain('more of that')
  })

  it('omits the reflection section entirely when nothing was written', () => {
    expect(formatReviewMarkdown(makeDetail())).not.toContain('## Reflection')
  })

  it('ends with exactly one trailing newline', () => {
    const md = formatReviewMarkdown(makeDetail({ worked: 'x' }))
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })
})
