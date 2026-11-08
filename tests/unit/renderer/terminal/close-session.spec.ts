import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { closeSessionFromFacts } from '../../../../src/renderer/terminal/close-session'
import { fact } from '../sidebar/fixtures/facts'

const closeSession = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  // The real store, with the one action that reaches the main process replaced.
  useSessionStore.setState({ ...useSessionStore.getInitialState(), closeSession })
})

describe('closeSessionFromFacts', () => {
  it('leaves the split and ends the session, as Cmd+W does', async () => {
    useSessionStore
      .getState()
      .activateSplit('p1', { targetId: 's1', newId: 's2', direction: 'vertical' })
    await closeSessionFromFacts(fact({ sessionId: 's1', projectId: 'p1' }))
    expect(useSessionStore.getState().getPaneLayout('p1')).toBeNull()
    expect(closeSession).toHaveBeenCalledWith('s1')
  })

  it('ends a scratch terminal, which belongs to no project', async () => {
    await closeSessionFromFacts(fact({ sessionId: 's2', projectId: null }))
    expect(closeSession).toHaveBeenCalledWith('s2')
  })

  it('does nothing to a session that has already closed', async () => {
    await closeSessionFromFacts(fact({ isClosed: true }))
    expect(closeSession).not.toHaveBeenCalled()
  })
})
