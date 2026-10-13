import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore, sessionKey } from '../../src/stores/pr-review.store'
import { ReviewSessionSchema } from '../../src/schemas/pr-review.schema'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../tests/support/fakes'

// What the main process does: it parses the session and replaces the stored one.
const storedSessions = vi.hoisted(() => new Map<string, unknown>())

vi.mock('../../src/api/github', async () => {
  const { ReviewSessionSchema: Schema } = await import('../../src/schemas/pr-review.schema')
  return {
    githubAPI: {
      sessionGet: vi.fn(async (key: string) => ({ session: storedSessions.get(key) ?? null })),
      sessionSet: vi.fn(async (key: string, session: unknown) => {
        storedSessions.set(key, Schema.parse(session))
        return { ok: true }
      }),
      saveActiveReview: vi.fn().mockResolvedValue({ ok: true }),
      removeActiveReview: vi.fn().mockResolvedValue({ ok: true }),
      prCompare: vi.fn().mockResolvedValue({ rewritten: false, commits: 0, files: [] }),
      filesViewedSet: vi.fn().mockResolvedValue({ ok: true }),
      fileViewedSet: vi.fn().mockResolvedValue({ ok: true }),
    },
  }
})

vi.mock('../../src/hooks/usePrReview', () => ({
  useLoadPrQueue: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useLoadPrDetail: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useFetchFileMetrics: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  useLoadIssueComments: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}))

vi.mock('../../src/components/pr-review/ReviewQueue', () => ({
  ReviewQueue: () => <div data-testid="review-queue" />,
}))

vi.mock('../../src/components/pr-review/PrOverviewPanel', () => ({
  PrOverviewPanel: () => null,
}))

vi.mock('../../src/components/pr-review/PrReviewView', () => ({
  PrReviewView: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close PR</button>
  ),
}))

const activePr = partialFake<PrReviewDetail>({ number: 5, title: 'Add login', headSHA: 'abc123' })
const key = sessionKey('/repo', 5)

beforeEach(() => {
  storedSessions.clear()
  usePrReviewStore.getState().reset()
  Object.assign(globalThis, {
    electronAPI: {
      extensionBridge: {
        invoke: vi.fn().mockResolvedValue({ ok: true }),
        on: vi.fn(() => () => {}),
      },
    },
  })
})

describe('closing a PR under review', () => {
  it('keeps the notes, drafts and viewed marks the reviewer has not submitted', async () => {
    usePrReviewStore.setState({
      activePr,
      viewedFiles: new Set(['src/a.ts']),
      viewedAt: { 'src/a.ts': 'abc123' },
      notes: [{ id: 'n1', path: 'src/a.ts', line: 3, side: 'RIGHT', body: 'why?', createdAt: 't' }],
      drafts: [
        {
          id: 'd1',
          path: 'src/a.ts',
          line: 4,
          startLine: null,
          side: 'RIGHT',
          body: 'rename this',
          fromFindingId: null,
        },
      ],
    })
    render(<PrReviewTab repoRoot="/repo" />)
    fireEvent.click(await screen.findByText('Close PR'))

    await waitFor(() => expect(storedSessions.get(key)).toBeDefined())
    const saved = ReviewSessionSchema.parse(storedSessions.get(key))
    expect(saved.pausedAt).not.toBeNull()
    expect(saved.drafts.map((d) => d.body)).toEqual(['rename this'])
    expect(saved.notes.map((n) => n.body)).toEqual(['why?'])
    expect(saved.viewedAt).toEqual({ 'src/a.ts': 'abc123' })
  })
})
