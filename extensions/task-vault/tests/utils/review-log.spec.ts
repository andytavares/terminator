import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logReviewAction } from '../../src/utils/review-log'

const mockInvoke = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue({})
  Object.assign(globalThis, {
    window: {
      electronAPI: { extensionBridge: { invoke: mockInvoke } },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('logReviewAction', logReviewActionTests)

function logReviewActionTests() {
  describe('logging', logReviewActionLoggingTests)
  describe('outside reviews and failures', logReviewActionOutsideReviewsFailuresTests)
}

function logReviewActionLoggingTests() {
  it('sends the action against the review', () => {
    logReviewAction('r1', {
      step: 5,
      action: 'task-promoted',
      entityType: 'task',
      entityId: 't1',
      entityLabel: 'Ship it',
    })

    expect(mockInvoke).toHaveBeenCalledWith('task-vault:review:log', {
      reviewId: 'r1',
      step: 5,
      action: 'task-promoted',
      entityType: 'task',
      entityId: 't1',
      entityLabel: 'Ship it',
    })
  })
}

function logReviewActionOutsideReviewsFailuresTests() {
  it('does nothing outside a review, so the shared inbox processor is unaffected', () => {
    logReviewAction(null, {
      step: 2,
      action: 'inbox-processed',
      entityType: 'task',
      entityLabel: 'x',
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('swallows a logging failure so the review can continue', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvoke.mockRejectedValueOnce(new Error('db gone'))

    expect(() =>
      logReviewAction('r1', {
        step: 1,
        action: 'captured',
        entityType: 'task',
        entityLabel: 'x',
      })
    ).not.toThrow()

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
    consoleError.mockRestore()
  })
}
