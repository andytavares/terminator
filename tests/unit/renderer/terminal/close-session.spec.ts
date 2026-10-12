import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { closeSessionFromFacts } from '../../../../src/renderer/terminal/close-session'
import { fact } from '../sidebar/fixtures/facts'

const closeSplitLeaf = vi.fn()
const closeSession = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  // The real store, with the two actions that reach the main process replaced.
  useSessionStore.setState({ ...useSessionStore.getInitialState(), closeSplitLeaf, closeSession })
})

describe('closeSessionFromFacts', () => {
  it('leaves the split before ending the session, as Cmd+W does', async () => {
    await closeSessionFromFacts(fact({ sessionId: 's1', projectId: 'p1' }))
    expect(closeSplitLeaf).toHaveBeenCalledWith('p1', 's1')
    expect(closeSession).toHaveBeenCalledWith('s1')
    expect(closeSplitLeaf.mock.invocationCallOrder[0]).toBeLessThan(
      closeSession.mock.invocationCallOrder[0]
    )
  })

  it('ends a scratch terminal, which belongs to no project', async () => {
    await closeSessionFromFacts(fact({ sessionId: 's2', projectId: null }))
    expect(closeSplitLeaf).not.toHaveBeenCalled()
    expect(closeSession).toHaveBeenCalledWith('s2')
  })

  it('does nothing to a session that has already closed', async () => {
    await closeSessionFromFacts(fact({ isClosed: true }))
    expect(closeSession).not.toHaveBeenCalled()
  })
})
