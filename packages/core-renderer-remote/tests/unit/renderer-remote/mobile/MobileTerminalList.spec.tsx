import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { Workspace } from '../../../../src/api/remote-client'
import type { TerminalSession } from '../../../../src/api/remote-client'

const mockOnSelectTerminal = vi.fn()
const mockOnCreateTerminal = vi.fn()
const mockOnAssignWorkspace = vi.fn()

const workspace: Workspace = {
  id: 'w1',
  name: 'My Workspace',
  folderPath: '/Users/me/projects',
  color: 'blue',
  tags: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderList(workspaces: Workspace[], terminals: TerminalSession[]) {
  const { MobileTerminalList } = await import('../../../../src/components/MobileTerminalList')
  return render(
    <MobileTerminalList
      workspaces={workspaces}
      terminals={terminals}
      onSelectTerminal={mockOnSelectTerminal}
      onCreateTerminal={mockOnCreateTerminal}
      onAssignWorkspace={mockOnAssignWorkspace}
    />
  )
}

describe('MobileTerminalList', () => {
  it('renders workspace names', async () => {
    await renderList([workspace], [])
    expect(screen.getByText('My Workspace').textContent).toBe('My Workspace')
  })
})

describe('MobileTerminalList — calls onCreateTerminal with workspaceId and folderPath when "New Terminal" is clicked', () => {
  it('calls onCreateTerminal with workspaceId and folderPath when "New Terminal" is clicked', async () => {
    const user = userEvent.setup()
    await renderList([workspace], [])
    await user.click(screen.getByRole('button', { name: /new terminal/i }))
    expect(mockOnCreateTerminal).toHaveBeenCalledWith('w1', '/Users/me/projects')
  })

  it('shows a terminal inside a workspace folder once, by its folder name', async () => {
    const terminal: TerminalSession = {
      sessionId: 's-ws',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([workspace], [terminal])
    expect(screen.getAllByText('myapp')).toHaveLength(1)
  })

  it('does not assign a terminal to workspace when cwd only shares a prefix without a path separator', async () => {
    // workspace.folderPath = '/Users/me/projects'
    // a cwd of '/Users/me/projects-extra' must NOT match
    const terminal: TerminalSession = {
      sessionId: 's-prefix-trap',
      cwd: '/Users/me/projects-extra/thing',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([workspace], [terminal])
    // Should appear once, in the fallback section, not under the workspace
    expect(screen.getAllByText('Scratch 1 · thing')).toHaveLength(1)
  })
})

describe('MobileTerminalList — labels unassigned terminals with "Scratch N · {basename}" prefix', () => {
  it('labels unassigned terminals with "Scratch N · {basename}" prefix', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-scratch-label',
      cwd: '/tmp/my-session',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    const assigned: TerminalSession = {
      sessionId: 's-ws-label',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    await renderList([workspace], [unmatched, assigned])
    // Unassigned terminal gets "Scratch N ·" prefix
    expect(screen.getAllByText('Scratch 1 · my-session')).toHaveLength(1)
    // Workspace-assigned terminal does NOT get the prefix
    expect(screen.getAllByText('myapp')).toHaveLength(1)
    expect(screen.queryByText('Scratch 1 · myapp')).toBeNull()
  })
})

describe('MobileTerminalList — selects an unmatched terminal from the fallback section with its sessionId and cwd', () => {
  it('selects an unmatched terminal from the fallback section with its sessionId and cwd', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-global',
      cwd: '/tmp/scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([workspace], [unmatched])
    await userEvent.click(screen.getByRole('button', { name: 'Scratch 1 · scratch' }))
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-global',
      cwd: '/tmp/scratch',
    })
  })
})

describe('MobileTerminalList — Enter on a workspace terminal', () => {
  it('triggers onSelectTerminal via Enter key on workspace terminal', async () => {
    const terminal: TerminalSession = {
      sessionId: 's-enter-ws',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([workspace], [terminal])
    const row = screen.getByRole('button', { name: 'myapp' })
    row.focus()
    expect(row.matches(':focus')).toBe(true)
    await userEvent.keyboard('{Enter}')
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-enter-ws',
      cwd: '/Users/me/projects/myapp',
    })
  })
})

describe('MobileTerminalList — triggers onSelectTerminal via Enter key on fallback terminal', () => {
  it('triggers onSelectTerminal via Enter key on fallback terminal', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-enter-global',
      cwd: '/tmp/enter-scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const user = userEvent.setup()
    await renderList([workspace], [unmatched])
    const row = screen.getByRole('button', { name: 'Scratch 1 · enter-scratch' })
    row.focus()
    expect(row.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-enter-global',
      cwd: '/tmp/enter-scratch',
    })
  })

  it('places a terminal with workspaceId override under the matching workspace regardless of cwd', async () => {
    const terminal: TerminalSession = {
      sessionId: 's-override',
      cwd: '/tmp/random',
      createdAt: '2026-06-19T10:00:00.000Z',
      workspaceId: 'w1',
    }
    await renderList([workspace], [terminal])
    // Should appear under the workspace (not in fallback)
    expect(screen.getAllByText('random')).toHaveLength(1)
    expect(screen.queryByText(/^Scratch/)).toBeNull()
  })
})

describe('MobileTerminalList — shows context menu with workspace options on right-click of fallback terminal', () => {
  it('shows context menu with workspace options on right-click of fallback terminal', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-ctx',
      cwd: '/tmp/ctx-scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([workspace], [unmatched])
    expect(screen.queryByRole('button', { name: 'My Workspace' })).toBeNull()
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Scratch 1 · ctx-scratch' }),
    })
    expect(screen.getByText('Move to workspace').textContent).toBe('Move to workspace')
    expect(screen.getByRole('button', { name: 'My Workspace' }).textContent).toBe('My Workspace')
  })
})

describe('MobileTerminalList — long-press', () => {
  it('long-press (touchStart → 500ms) opens context menu on scratch terminal', async () => {
    vi.useFakeTimers()
    const unmatched: TerminalSession = {
      sessionId: 's-longpress',
      cwd: '/tmp/longpress',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    await renderList([workspace], [unmatched])
    const btn = screen.getByRole('button', { name: 'Scratch 1 · longpress' })
    fireEvent.touchStart(btn, { touches: [{ clientX: 50, clientY: 100 }] })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getAllByText('Move to workspace')).toHaveLength(1)
  })
})

describe('MobileTerminalList — touchEnd before 500ms cancels long-press and no context menu appears', () => {
  it('touchEnd before 500ms cancels long-press and no context menu appears', async () => {
    vi.useFakeTimers()
    const unmatched: TerminalSession = {
      sessionId: 's-touchend',
      cwd: '/tmp/touchend',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    await renderList([workspace], [unmatched])
    const btn = screen.getByRole('button', { name: 'Scratch 1 · touchend' })
    fireEvent.touchStart(btn, { touches: [{ clientX: 50, clientY: 100 }] })
    fireEvent.touchEnd(btn)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('Move to workspace')).toBeNull()
  })
})

describe('MobileTerminalList — touchMove before 500ms cancels long-press and no context menu appears', () => {
  it('touchMove before 500ms cancels long-press and no context menu appears', async () => {
    vi.useFakeTimers()
    const unmatched: TerminalSession = {
      sessionId: 's-touchmove',
      cwd: '/tmp/touchmove',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    await renderList([workspace], [unmatched])
    const btn = screen.getByRole('button', { name: 'Scratch 1 · touchmove' })
    fireEvent.touchStart(btn, { touches: [{ clientX: 50, clientY: 100 }] })
    fireEvent.touchMove(btn)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('Move to workspace')).toBeNull()
  })
})

describe('MobileTerminalList — a context menu with no workspaces', () => {
  it('shows "No workspaces" message in context menu when workspace list is empty', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-noworkspace',
      cwd: '/tmp/noworkspace',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([], [unmatched])
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Scratch 1 · noworkspace' }),
    })
    expect(screen.getByText('No workspaces').textContent).toBe('No workspaces')
  })
})

describe('MobileTerminalList — calls onAssignWorkspace when a workspace is chosen from context menu', () => {
  it('calls onAssignWorkspace when a workspace is chosen from context menu', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-assign',
      cwd: '/tmp/assign-scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const user = userEvent.setup()
    await renderList([workspace], [unmatched])
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Scratch 1 · assign-scratch' }),
    })
    await user.click(screen.getByRole('button', { name: 'My Workspace' }))
    expect(mockOnAssignWorkspace).toHaveBeenCalledWith('s-assign', 'w1')
  })
})

describe('MobileTerminalList — second touchStart on a different terminal cancels first long-press timer', () => {
  it('second touchStart on a different terminal cancels first long-press timer', async () => {
    vi.useFakeTimers()
    const termA: TerminalSession = {
      sessionId: 's-timer-a',
      cwd: '/tmp/timer-a',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    const termB: TerminalSession = {
      sessionId: 's-timer-b',
      cwd: '/tmp/timer-b',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    await renderList([], [termA, termB])
    const btnA = screen.getByRole('button', { name: 'Scratch 1 · timer-a' })
    const btnB = screen.getByRole('button', { name: 'Scratch 2 · timer-b' })
    // Start long-press on A, then immediately start one on B
    fireEvent.touchStart(btnA, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchStart(btnB, { touches: [{ clientX: 20, clientY: 20 }] })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    // Only B's context menu should have fired — A's timer was cleared
    const menus = screen.queryAllByText('Move to workspace')
    expect(menus).toHaveLength(1)
  })
})

describe('MobileTerminalList — resets longPressFired after blocking a click, so subsequent taps on any terminal work', () => {
  it('resets longPressFired after blocking a click, so subsequent taps on any terminal work', async () => {
    vi.useFakeTimers()
    const wsTerm: TerminalSession = {
      sessionId: 's-ws',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const unassigned: TerminalSession = {
      sessionId: 's-scratch',
      cwd: '/tmp/scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    await renderList([workspace], [wsTerm, unassigned])
    // Long-press the unassigned terminal to set longPressFired = true
    fireEvent.touchStart(screen.getByText('Scratch 1 · scratch'), {
      touches: [{ clientX: 10, clientY: 10 }],
    })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    // Click the workspace terminal — blocked by longPressFired, but flag is cleared
    await userEvent.click(screen.getByRole('button', { name: 'myapp' }))
    expect(mockOnSelectTerminal).not.toHaveBeenCalled()
    // Second click should now go through
    await userEvent.click(screen.getByRole('button', { name: 'myapp' }))
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-ws',
      cwd: '/Users/me/projects/myapp',
    })
  })
})

describe('MobileTerminalList — backdrop touchStart does not close context menu before menu item click fires', () => {
  it('backdrop touchStart does not close context menu before menu item click fires', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-backdrop-touch',
      cwd: '/tmp/backdrop',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    const user = userEvent.setup()
    await renderList([workspace], [unmatched])
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Scratch 1 · backdrop' }),
    })
    expect(screen.getAllByText('Move to workspace')).toHaveLength(1)

    // touchStart on the backdrop should NOT close the menu (user-event has no touch input)
    // eslint-disable-next-line testing-library/no-node-access -- the backdrop is a bare div with no role, label or text
    const backdrop = document.querySelector('.mobile-context-menu-backdrop') as HTMLElement
    expect(backdrop).not.toBeNull()
    fireEvent.touchStart(backdrop)
    expect(screen.getByText('Move to workspace')).toBeTruthy()

    // click on backdrop closes it
    await user.click(backdrop)
    expect(screen.queryByText('Move to workspace')).toBeNull()
  })
})
