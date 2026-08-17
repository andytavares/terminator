import { describe, it, expect, vi, beforeEach } from 'vitest'
import { focusActiveTerminal } from '../../../../src/renderer/lib/focus-terminal'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'

const focus = vi.fn()

function stubSession(overrides: Record<string, unknown> = {}): void {
  useSessionStore.setState({
    getFocusedSession: () => null,
    getActiveSessionForProject: () => null,
    getTerminalInstance: () => undefined,
    ...overrides,
  } as never)
}

describe('focusActiveTerminal', () => {
  beforeEach(() => {
    focus.mockReset()
    useWorkspaceStore.setState({ activeProjectId: 'proj-1', scratchActive: false } as never)
    stubSession()
  })

  it('focuses the project’s active session', () => {
    stubSession({
      getActiveSessionForProject: (id: string) => (id === 'proj-1' ? 'sess-1' : null),
      getTerminalInstance: (id: string) => (id === 'sess-1' ? { terminal: { focus } } : undefined),
    })

    focusActiveTerminal()

    expect(focus).toHaveBeenCalled()
  })

  it('prefers the focused split pane over the project’s active session', () => {
    stubSession({
      getFocusedSession: () => 'sess-split',
      getActiveSessionForProject: () => 'sess-1',
      getTerminalInstance: (id: string) =>
        id === 'sess-split' ? { terminal: { focus } } : undefined,
    })

    focusActiveTerminal()

    expect(focus).toHaveBeenCalled()
  })

  it('uses the scratch project when scratch mode is active', () => {
    useWorkspaceStore.setState({ activeProjectId: null, scratchActive: true } as never)
    stubSession({
      getActiveSessionForProject: (id: string) => (id === SCRATCH_PROJECT_ID ? 'scratch-1' : null),
      getTerminalInstance: () => ({ terminal: { focus } }),
    })

    focusActiveTerminal()

    expect(focus).toHaveBeenCalled()
  })

  it('does nothing when no project is active', () => {
    useWorkspaceStore.setState({ activeProjectId: null, scratchActive: false } as never)

    expect(() => focusActiveTerminal()).not.toThrow()
    expect(focus).not.toHaveBeenCalled()
  })

  it('does nothing when the project has no session', () => {
    focusActiveTerminal()
    expect(focus).not.toHaveBeenCalled()
  })

  it('does nothing when the session has no mounted terminal', () => {
    stubSession({ getActiveSessionForProject: () => 'sess-1' })

    expect(() => focusActiveTerminal()).not.toThrow()
    expect(focus).not.toHaveBeenCalled()
  })
})
