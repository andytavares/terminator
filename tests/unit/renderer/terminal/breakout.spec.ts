// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eventually } from '../../../support/eventually'
import { breakOut, dockBack, toggleBreakout } from '../../../../src/renderer/terminal/breakout'
import { revealSession } from '../../../../src/renderer/terminal/navigate-to-session'
import { isBrokenOut, useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { breakoutFrameName } from '../../../../src/shared/breakout'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import { installElectronApi } from '../../../support/electron-api'
import { resetStore, terminalSessionOf } from '../../../support/renderer-stores'
import { sessionState } from '../../../support/store-state'

vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({
  revealSession: vi.fn(),
}))

const notificationsCreate = vi.fn()

/** What window.open hands back: a document of its own, a focus and a close. */
function fakeChildWindow() {
  const childDocument = document.implementation.createHTMLDocument('breakout')
  const child = {
    document: childDocument,
    closed: false,
    focus: vi.fn(),
    close: vi.fn(() => {
      child.closed = true
    }),
  }
  return child
}

let opened: ReturnType<typeof fakeChildWindow>
const open = vi.fn()

function seedSessions(projectId: string, ids: string[]): void {
  useSessionStore.setState({
    sessions: new Map(
      ids.map((id) => [id, terminalSessionOf({ id, projectId, tabTitle: `T-${id}` })])
    ),
    projectViews: new Map([
      [projectId, { terminalCounter: ids.length, order: ids, activeSessionId: ids[0] }],
    ]),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore(useSessionStore)
  resetStore(useBreakoutStore)
  resetStore(useWorkspaceStore, { activeProjectId: 'p1' })
  opened = fakeChildWindow()
  open.mockReturnValue(opened)
  vi.spyOn(window, 'open').mockImplementation(open)
  installElectronApi({ notifications: { create: notificationsCreate } })
  document.head.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => vi.restoreAllMocks())

describe('breakOut', () => {
  it('opens a window named for the session and records it', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1', { x: 300, y: 120 })
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      breakoutFrameName('s1'),
      expect.stringContaining('left=300,top=120')
    )
    expect(useBreakoutStore.getState().windows.get('s1')).toBe(opened)
  })

  it('sizes the window like the terminal, or 800 by 500 when it has no size yet', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    expect(open.mock.calls[0]?.[2]).toContain('width=800,height=500')
  })

  it('offsets the window 40 pixels from the main window when no position is given', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    const expected = `left=${window.screenX + 40},top=${window.screenY + 40}`
    expect(open.mock.calls[0]?.[2]).toContain(expected)
  })
})

describe('breakOut — what stays in the main window', () => {
  it('opens one window however often it is asked', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    breakOut('s1')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a session that does not exist', () => {
    breakOut('missing')
    expect(open).not.toHaveBeenCalled()
  })

  it('makes the next tab of the project active so the main pane lets go', () => {
    seedSessions('p1', ['s1', 's2', 's3'])
    breakOut('s1')
    expect(sessionState().getActiveSessionForProject('p1')).toBe('s2')
  })

  it('unsplits the pane it takes out of the main pane', () => {
    seedSessions('p1', ['s1', 's2'])
    const closeSplitLeaf = vi.fn()
    useSessionStore.setState({ closeSplitLeaf })
    breakOut('s2')
    expect(closeSplitLeaf).toHaveBeenCalledWith('p1', 's2')
  })
})

describe('breakOut — when the window is blocked', () => {
  it('says so in plain words and records nothing when the window is blocked', () => {
    seedSessions('p1', ['s1', 's2'])
    open.mockReturnValue(null)
    breakOut('s1')
    expect(isBrokenOut('s1')).toBe(false)
    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('could not open its own window'),
      })
    )
    expect(sessionState().getActiveSessionForProject('p1')).toBe('s1')
  })

  it('titles the window with the tab title', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    expect(opened.document.title).toBe('T-s1')
  })
})

describe('breakOut — styling the window like the main one', () => {
  it('copies the stylesheets and style elements of the main document', () => {
    document.head.innerHTML =
      '<link rel="stylesheet" href="app.css"><style>.a{}</style><meta charset="utf-8">'
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    expect(opened.document.head.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      'app.css'
    )
    expect(opened.document.head.querySelector('style')?.textContent).toBe('.a{}')
    expect(opened.document.head.querySelector('meta')).toBeNull()
  })

  it('gives the window the theme and follows a later change', async () => {
    document.documentElement.dataset.theme = 'light'
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    expect(opened.document.documentElement.dataset.theme).toBe('light')
    document.documentElement.dataset.theme = 'dark'
    await eventually(() => expect(opened.document.documentElement.dataset.theme).toBe('dark'))
  })
})

describe('breakOut — styles added later', () => {
  it('copies a style added to the main document later', async () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    const added = document.createElement('style')
    added.textContent = '.late{}'
    document.head.appendChild(added)
    await eventually(() =>
      expect(opened.document.head.querySelector('style')?.textContent).toBe('.late{}')
    )
  })
})

describe('breakOut — leaving the main document', () => {
  it('stops watching the main document once the window is docked', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    expect(disconnect).not.toHaveBeenCalled()
    dockBack('s1')
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})

describe('dockBack', () => {
  it('closes the window, forgets it and reveals the session in its old place', () => {
    seedSessions('p1', ['s1', 's2', 's3'])
    breakOut('s2')
    dockBack('s2')
    expect(opened.close).toHaveBeenCalled()
    expect(isBrokenOut('s2')).toBe(false)
    expect(revealSession).toHaveBeenCalledWith('s2')
    expect(
      sessionState()
        .getSessionsForProject('p1')
        .map((s) => s.id)
    ).toEqual(['s1', 's2', 's3'])
  })
})

describe('dockBack — nothing to dock', () => {
  it('does not close a window the user already closed', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    opened.closed = true
    dockBack('s1')
    expect(opened.close).not.toHaveBeenCalled()
    expect(revealSession).toHaveBeenCalledWith('s1')
  })

  it('does nothing for a session that is not in its own window', () => {
    seedSessions('p1', ['s1'])
    dockBack('s1')
    expect(revealSession).not.toHaveBeenCalled()
  })

  it('only cleans up when the session no longer exists', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    useSessionStore.setState({ sessions: new Map() })
    dockBack('s1')
    expect(isBrokenOut('s1')).toBe(false)
    expect(revealSession).not.toHaveBeenCalled()
  })
})

describe('a session that ends while in its own window', () => {
  it('closes the window and forgets it', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    useSessionStore.setState({
      sessions: new Map([['s2', terminalSessionOf({ id: 's2', projectId: 'p1' })]]),
    })
    expect(opened.close).toHaveBeenCalled()
    expect(isBrokenOut('s1')).toBe(false)
  })
})

describe('toggleBreakout', () => {
  it('docks the session it is given', () => {
    seedSessions('p1', ['s1', 's2'])
    breakOut('s1')
    toggleBreakout('s1')
    expect(isBrokenOut('s1')).toBe(false)
  })
})

describe('toggleBreakout — with no session given', () => {
  it('breaks out the focused pane of the active branch when given none', () => {
    seedSessions('p1', ['s1', 's2', 's3'])
    useSessionStore.setState({
      projectViews: new Map([
        [
          'p1',
          {
            terminalCounter: 3,
            order: ['s1', 's2', 's3'],
            activeSessionId: 's1',
            focusedSessionId: 's3',
            paneLayouts: [
              {
                type: 'split',
                id: 'split-1',
                direction: 'vertical',
                ratio: 0.5,
                first: { type: 'leaf', sessionId: 's1' },
                second: { type: 'leaf', sessionId: 's3' },
              },
            ],
          },
        ],
      ]),
    })
    toggleBreakout(null)
    expect(isBrokenOut('s3')).toBe(true)
  })
})

describe('toggleBreakout — with no pane focused', () => {
  it('breaks out the active tab when no pane is focused', () => {
    seedSessions('p1', ['s1', 's2'])
    toggleBreakout(null)
    expect(isBrokenOut('s1')).toBe(true)
  })

  it('breaks out the scratch terminal when scratch is showing', () => {
    seedSessions(SCRATCH_PROJECT_ID, ['sc1', 'sc2'])
    useWorkspaceStore.setState({ scratchActive: true, activeProjectId: null })
    toggleBreakout(null)
    expect(isBrokenOut('sc1')).toBe(true)
  })

  it('does nothing when nothing is showing', () => {
    useWorkspaceStore.setState({ activeProjectId: null })
    toggleBreakout(null)
    expect(open).not.toHaveBeenCalled()
  })
})
