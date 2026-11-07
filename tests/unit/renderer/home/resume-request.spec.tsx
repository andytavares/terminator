import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { WorkThread } from '../../../../src/renderer/home/work-threads'

const threads = vi.hoisted(() => ({ all: [] as WorkThread[] }))
const resumeSession = vi.hoisted(() => vi.fn())
const latest = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/components/home/useWorkThreads', () => ({
  useWorkThreads: () => ({ threads: [], groups: [], allThreads: threads.all }),
}))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({ resumeSession }))
vi.mock('../../../../src/renderer/home/work-threads', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  latestResumableSession: latest,
}))

import {
  useDeskSelection,
  useOpenRequestedResume,
} from '../../../../src/renderer/components/home/desk-selection'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.setState({ toasts: [] })
  useDeskSelection.setState({ resumeRequested: true })
})

describe('Resume a conversation…', () => {
  it('reopens the latest ended conversation and clears the request', () => {
    const session = { sessionId: 'ended-1' }
    latest.mockReturnValue(session)
    renderHook(() => useOpenRequestedResume())
    expect(resumeSession).toHaveBeenCalledWith(session)
    expect(useDeskSelection.getState().resumeRequested).toBe(false)
  })

  it('clears the request and says so when nothing can be resumed, so nothing resumes later', () => {
    latest.mockReturnValue(undefined)
    renderHook(() => useOpenRequestedResume())
    expect(resumeSession).not.toHaveBeenCalled()
    expect(useDeskSelection.getState().resumeRequested).toBe(false)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'No conversation to resume.',
    ])
  })
})
