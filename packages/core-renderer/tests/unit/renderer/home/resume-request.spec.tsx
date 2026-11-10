import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { WorkThread } from '../../../../src/home/work-threads'

const threads = vi.hoisted(() => ({ all: [] as WorkThread[] }))
const resumeSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/components/home/useWorkThreads', () => ({
  useWorkThreads: () => ({
    threads: [],
    groups: [],
    allThreads: threads.all,
    settledThreads: [],
  }),
}))
vi.mock('../../../../src/terminal/start-session', () => ({ resumeSession }))

import {
  useDeskSelection,
  useOpenRequestedResume,
} from '../../../../src/components/home/desk-selection'
import { useToastStore } from '../../../../src/stores/toast.store'
import { partialFake } from '../../../../../test-support/src/fakes'
import { fact } from '../sidebar/fixtures/facts'

const agent = {
  agentId: 'claude',
  transport: 'tui' as const,
  sessionId: 'conv-1',
  cwd: '/repos/terminator',
  transcriptPath: '/repos/terminator/conv-1.jsonl',
  capturedAt: '2026-10-18T09:00:00.000Z',
}
const ended = (sessionId: string, lastActivityAt: number) =>
  fact({ sessionId, isClosed: true, state: 'exited', resumable: true, agent, lastActivityAt })

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.setState({ toasts: [] })
  useDeskSelection.setState({ resumeRequested: true })
  threads.all = []
})

describe('Resume a conversation…', () => {
  it('reopens the latest ended conversation and clears the request', () => {
    const latest = ended('ended-2', 20)
    threads.all = [partialFake<WorkThread>({ sessions: [ended('ended-1', 10), latest] })]
    renderHook(() => useOpenRequestedResume())
    expect(resumeSession).toHaveBeenCalledWith(latest)
    expect(useDeskSelection.getState().resumeRequested).toBe(false)
  })

  it('clears the request and says so when nothing can be resumed, so nothing resumes later', () => {
    threads.all = [partialFake<WorkThread>({ sessions: [fact({ sessionId: 'open-1' })] })]
    renderHook(() => useOpenRequestedResume())
    expect(resumeSession).not.toHaveBeenCalled()
    expect(useDeskSelection.getState().resumeRequested).toBe(false)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'No conversation to resume.',
    ])
  })
})
