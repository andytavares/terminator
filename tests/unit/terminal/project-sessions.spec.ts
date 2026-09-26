import { describe, it, expect, vi, afterEach } from 'vitest'
import { closeSessionsOfDeletedProjects } from '../../../src/main/terminal/project-sessions'
import { emitProjectDelete } from '../../../src/main/extensions/workspace-events'

// A deleted project takes its terminals with it. Left running, a session has
// no project to show it in and keeps its process — and, for an agent, keeps
// working in a checkout that is being removed.

let stop: (() => void) | null = null
afterEach(() => stop?.())

function sessions() {
  return [
    { sessionId: 's1', projectId: 'p-gone' },
    { sessionId: 's2', projectId: 'p-kept' },
    { sessionId: 's3', projectId: 'p-gone' },
    { sessionId: 's4' },
  ]
}

describe('closeSessionsOfDeletedProjects', () => {
  it('kills every session of the deleted project, and only those', () => {
    const kill = vi.fn()
    const markClosed = vi.fn().mockResolvedValue(undefined)
    stop = closeSessionsOfDeletedProjects({
      pty: { listSessions: () => sessions() as never, kill },
      markClosed,
      now: () => new Date('2026-09-26T12:00:00Z'),
    })
    emitProjectDelete('p-gone')
    expect(kill.mock.calls.map(([id]) => id)).toEqual(['s1', 's3'])
  })

  it('marks each record closed, so Home stops listing it as open', () => {
    const markClosed = vi.fn().mockResolvedValue(undefined)
    const at = new Date('2026-09-26T12:00:00Z')
    stop = closeSessionsOfDeletedProjects({
      pty: { listSessions: () => sessions() as never, kill: vi.fn() },
      markClosed,
      now: () => at,
    })
    emitProjectDelete('p-gone')
    expect(markClosed).toHaveBeenCalledWith('s1', at)
    expect(markClosed).toHaveBeenCalledWith('s3', at)
    expect(markClosed).toHaveBeenCalledTimes(2)
  })

  it('stamps the close with the current time when no clock is given', () => {
    const markClosed = vi.fn().mockResolvedValue(undefined)
    stop = closeSessionsOfDeletedProjects({
      pty: { listSessions: () => sessions() as never, kill: vi.fn() },
      markClosed,
    })
    const before = Date.now()
    emitProjectDelete('p-gone')
    const at = markClosed.mock.calls[0][1] as Date
    expect(at.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('stops listening once disposed', () => {
    const kill = vi.fn()
    closeSessionsOfDeletedProjects({
      pty: { listSessions: () => sessions() as never, kill },
      markClosed: vi.fn().mockResolvedValue(undefined),
    })()
    emitProjectDelete('p-gone')
    expect(kill).not.toHaveBeenCalled()
  })
})
