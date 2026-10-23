import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { LivePreview } from '../../../../src/renderer/components/session/LivePreview'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import type { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { seedStore, terminalSessionOf } from '../../../support/renderer-stores'
import { partialFake } from '../../../support/fakes'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({ revealSession }))

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
    const { container } = render(<LivePreview sessionId="s1" />)
    expect(mountPreview).toHaveBeenCalledTimes(1)
    expect(mountPreview).toHaveBeenCalledWith(container.querySelector('.live-preview'))
  })

  it('gives the terminal back when it unmounts', () => {
    const { unmount } = render(<LivePreview sessionId="s1" />)
    unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps the same node and does not remount when anything but the session changes', () => {
    const { container, rerender } = render(<LivePreview sessionId="s1" className="a" />)
    const node = container.querySelector('.live-preview')
    rerender(<LivePreview sessionId="s1" className="b" />)
    expect(container.querySelector('.live-preview')).toBe(node)
    expect(mountPreview).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('draws an empty box for a session with no terminal yet', () => {
    const { container } = render(<LivePreview sessionId="none" />)
    expect(container.querySelector('.live-preview')).not.toBeNull()
    expect(mountPreview).not.toHaveBeenCalled()
  })
})

describe('LivePreview — a terminal in its own window', () => {
  beforeEach(() => seedStore(useBreakoutStore, { windows: new Map([['s1', window]]) }))

  it('leaves the terminal in its window and shows its latest line instead', () => {
    const { container } = render(<LivePreview sessionId="s1" />)
    expect(mountPreview).not.toHaveBeenCalled()
    expect(container.querySelector('.live-preview')).toBeNull()
    expect(screen.getByText('Running 14 tests')).toBeTruthy()
    expect(screen.getByText('In its own window')).toBeTruthy()
  })

  it('brings its window forward from the Show window button', () => {
    render(<LivePreview sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Show window' }))
    expect(revealSession).toHaveBeenCalledWith('s1')
  })

  it('mounts the preview again once the terminal is docked', () => {
    render(<LivePreview sessionId="s1" />)
    act(() => useBreakoutStore.setState({ windows: new Map() }))
    expect(mountPreview).toHaveBeenCalledTimes(1)
  })
})
