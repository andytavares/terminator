import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

import { LivePreview } from '../../../../src/renderer/components/session/LivePreview'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import type { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'
import { seedStore } from '../../../support/renderer-stores'

const cleanup = vi.fn()
const mountPreview = vi.fn(() => cleanup)
// xterm does not run in jsdom: the instance is faked down to what LivePreview calls.
const instance = { mountPreview } as unknown as TerminalInstance

beforeEach(() => {
  vi.clearAllMocks()
  seedStore(useSessionStore, {
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
