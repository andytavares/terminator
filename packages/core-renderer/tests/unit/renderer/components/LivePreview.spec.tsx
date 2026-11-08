import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LivePreview } from '../../../../src/components/session/LivePreview'
import { useSessionStore } from '../../../../src/stores/session.store'
import type { TerminalInstance } from '../../../../src/components/terminal/TerminalSession'
import { useBreakoutStore } from '../../../../src/stores/breakout.store'
import { seedStore, terminalSessionOf } from '../../../../../test-support/src/renderer-stores'
import { partialFake } from '../../../../../test-support/src/fakes'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/terminal/navigate-to-session', () => ({ revealSession }))

const cleanup = vi.fn()
const mountPreview = vi.fn(() => cleanup)
// xterm does not run in jsdom: the instance is faked down to what LivePreview calls.
const instance = partialFake<TerminalInstance>({ mountPreview })

beforeEach(() => {
  vi.clearAllMocks()
  seedStore(useBreakoutStore, { windows: new Map() })
  seedStore(useSessionStore, {
    sessions: new Map([
      ['s1', terminalSessionOf({ id: 's1', projectId: 'p1', latestLine: 'Running 14 tests' })],
    ]),
    getTerminalInstance: (id: string) => (id === 'none' ? undefined : instance),
  })
})

describe('LivePreview', () => {
  it("moves the session's live terminal into its container", () => {
    render(<LivePreview sessionId="s1" />)
    expect(mountPreview).toHaveBeenCalledTimes(1)
    expect(mountPreview).toHaveBeenCalledWith(screen.getByTestId('live-preview'))
  })

  it('gives the terminal back when it unmounts', () => {
    const { unmount } = render(<LivePreview sessionId="s1" />)
    unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps the same node and does not remount when anything but the session changes', () => {
    const { rerender } = render(<LivePreview sessionId="s1" className="a" />)
    const node = screen.getByTestId('live-preview')
    rerender(<LivePreview sessionId="s1" className="b" />)
    expect(screen.getByTestId('live-preview')).toBe(node)
    expect(mountPreview).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('draws an empty box for a session with no terminal yet', () => {
    render(<LivePreview sessionId="none" />)
    expect(screen.getByTestId('live-preview').innerHTML).toBe('')
    expect(mountPreview).not.toHaveBeenCalled()
  })
})

describe('LivePreview — a terminal in its own window', () => {
  beforeEach(() => seedStore(useBreakoutStore, { windows: new Map([['s1', window]]) }))

  it('leaves the terminal in its window and shows its latest line instead', () => {
    render(<LivePreview sessionId="s1" />)
    expect(mountPreview).not.toHaveBeenCalled()
    expect(screen.queryByTestId('live-preview')).toBeNull()
    expect(screen.getByText('Running 14 tests')).toBeTruthy()
    expect(screen.getByText('In its own window')).toBeTruthy()
  })

  it('brings its window forward from the Show window button', async () => {
    const user = userEvent.setup()
    render(<LivePreview sessionId="s1" />)
    await user.click(screen.getByRole('button', { name: 'Show window' }))
    expect(revealSession).toHaveBeenCalledWith('s1')
  })

  it('mounts the preview again once the terminal is docked', () => {
    render(<LivePreview sessionId="s1" />)
    act(() => useBreakoutStore.setState({ windows: new Map() }))
    expect(mountPreview).toHaveBeenCalledTimes(1)
  })
})
