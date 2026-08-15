import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExtensionEscapeExit } from '../../../../src/renderer/hooks/useExtensionEscapeExit'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useModalStore } from '../../../../src/renderer/stores/modal.store'
import { DOUBLE_ESCAPE_WINDOW_MS } from '../../../../src/shared/double-escape'

const mockExit = vi.fn()
const mockFocusTerminal = vi.fn()
let exitEventHandler: ((payload: unknown) => void) | null = null
const mockUnsubscribe = vi.fn()

vi.mock('../../../../src/renderer/lib/focus-terminal', () => ({
  focusActiveTerminal: () => mockFocusTerminal(),
}))

function pressEscape(target?: EventTarget): void {
  act(() => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    ;(target ?? window).dispatchEvent(event)
  })
}

describe('useExtensionEscapeExit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockExit.mockReset().mockReturnValue(true)
    mockFocusTerminal.mockReset()
    mockUnsubscribe.mockReset()
    exitEventHandler = null

    useExtensionRegistry.setState({ exitExtensionToTerminal: mockExit })
    useModalStore.setState({ depth: 0 })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      extensionEvents: {
        onExtensionExitToTerminal: (handler: (payload: unknown) => void) => {
          exitEventHandler = handler
          return mockUnsubscribe
        },
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('host renderer Escape handling', () => {
    it('ignores a single Escape', () => {
      renderHook(() => useExtensionEscapeExit())
      pressEscape()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('exits on a second Escape inside the window', () => {
      renderHook(() => useExtensionEscapeExit())
      pressEscape()
      pressEscape()
      expect(mockExit).toHaveBeenCalledWith(undefined)
    })

    it('does not exit when the presses are too far apart', () => {
      renderHook(() => useExtensionEscapeExit())
      pressEscape()
      vi.advanceTimersByTime(DOUBLE_ESCAPE_WINDOW_MS + 1)
      pressEscape()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('focuses the terminal after a successful exit', () => {
      renderHook(() => useExtensionEscapeExit())
      pressEscape()
      pressEscape()
      act(() => {
        vi.runAllTimers()
      })
      expect(mockFocusTerminal).toHaveBeenCalled()
    })

    it('does not focus the terminal when there was nothing to exit', () => {
      mockExit.mockReturnValue(false)
      renderHook(() => useExtensionEscapeExit())
      pressEscape()
      pressEscape()
      act(() => {
        vi.runAllTimers()
      })
      expect(mockFocusTerminal).not.toHaveBeenCalled()
    })

    it('leaves Escape alone inside a terminal, where it belongs to the shell', () => {
      const xterm = document.createElement('div')
      xterm.className = 'xterm'
      const child = document.createElement('div')
      xterm.appendChild(child)
      document.body.appendChild(xterm)

      renderHook(() => useExtensionEscapeExit())
      pressEscape(child)
      pressEscape(child)

      expect(mockExit).not.toHaveBeenCalled()
    })

    it('leaves Escape alone inside a text field', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)

      renderHook(() => useExtensionEscapeExit())
      pressEscape(input)
      pressEscape(input)

      expect(mockExit).not.toHaveBeenCalled()
    })

    it('does not exit while a core modal is open', () => {
      useModalStore.setState({ depth: 1 })
      renderHook(() => useExtensionEscapeExit())
      pressEscape()
      pressEscape()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('ignores keys other than Escape', () => {
      renderHook(() => useExtensionEscapeExit())
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      })
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('removes its listener on unmount', () => {
      const { unmount } = renderHook(() => useExtensionEscapeExit())
      unmount()
      pressEscape()
      pressEscape()
      expect(mockExit).not.toHaveBeenCalled()
    })
  })

  describe('exit requests relayed from an extension view', () => {
    it('exits the full-screen surface when no sidebar panel is named', () => {
      renderHook(() => useExtensionEscapeExit())
      act(() => exitEventHandler?.({ extensionId: 'notepad', sidebarPanelId: null }))
      expect(mockExit).toHaveBeenCalledWith(undefined)
    })

    it('closes the named sidebar panel', () => {
      renderHook(() => useExtensionEscapeExit())
      act(() =>
        exitEventHandler?.({ extensionId: 'git-integration', sidebarPanelId: 'git-integration' })
      )
      expect(mockExit).toHaveBeenCalledWith('git-integration')
    })

    it('focuses the terminal after exiting', () => {
      renderHook(() => useExtensionEscapeExit())
      act(() => exitEventHandler?.({ extensionId: 'notepad', sidebarPanelId: null }))
      act(() => {
        vi.runAllTimers()
      })
      expect(mockFocusTerminal).toHaveBeenCalled()
    })

    it('unsubscribes on unmount', () => {
      const { unmount } = renderHook(() => useExtensionEscapeExit())
      unmount()
      expect(mockUnsubscribe).toHaveBeenCalled()
    })

    it('survives a transport without the exit event (remote shim)', () => {
      ;(window as unknown as { electronAPI: unknown }).electronAPI = { extensionEvents: {} }
      expect(() => renderHook(() => useExtensionEscapeExit())).not.toThrow()
    })
  })
})
