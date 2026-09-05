import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FileText } from 'lucide-react'
import { IconButton } from '../../../../packages/extension-ui/src/IconButton'
import { Popover } from '../../../../packages/extension-ui/src/Popover'
import { Toast } from '../../../../packages/extension-ui/src/Toast'
import {
  captureFocus,
  focusableWithin,
  trapTab,
} from '../../../../packages/extension-ui/src/focus-trap'

// The paths the happy-path specs do not reach: empty surfaces, absent optional
// props, timers that do and do not fire, and an opener that is gone by the time
// focus should return to it.

describe('IconButton edges', () => {
  it('takes an extra class without losing its own', () => {
    render(
      <IconButton icon={FileText} label="List view" className="tv-toggle" onClick={() => {}} />
    )
    const button = screen.getByRole('button', { name: 'List view' })
    expect(button.className).toContain('tmui-icon-button')
    expect(button.className).toContain('tv-toggle')
  })

  it('omits aria-pressed entirely when it is not a toggle', () => {
    render(<IconButton icon={FileText} label="Close" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('aria-pressed')).toBe(false)
  })

  it('reports the unpressed state of a toggle', () => {
    render(<IconButton icon={FileText} label="List view" pressed={false} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })
})

describe('Popover edges', () => {
  it('takes an extra class without losing its own', () => {
    const { container } = render(
      <Popover label="Pick" className="tv-picker" onDismiss={() => {}}>
        <button type="button">One</button>
      </Popover>
    )
    const el = container.querySelector('.tmui-popover')!
    expect(el.className).toContain('tv-picker')
  })

  it('ignores keys other than Escape', () => {
    const onDismiss = vi.fn()
    render(
      <Popover label="Pick" onDismiss={onDismiss}>
        <button type="button">One</button>
      </Popover>
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('leaves the outer surface alone when Escape reaches a nested one', () => {
    const onOuter = vi.fn()
    const onInner = vi.fn()
    render(
      <>
        <Popover label="Outer" onDismiss={onOuter}>
          <button type="button">Outer</button>
        </Popover>
        <Popover label="Inner" onDismiss={onInner}>
          <button type="button">Inner</button>
        </Popover>
      </>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onInner).toHaveBeenCalledTimes(1)
    expect(onOuter).not.toHaveBeenCalled()
  })
})

describe('Toast edges', () => {
  it('dismisses itself once its duration elapses', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast message="Saved" duration={100} onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  // An error is the one you have to read, so it waits for you.
  it('stays until dismissed when it reports an error', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast message="Port in use" tone="error" onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('treats a zero duration as sticky', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast message="Working…" duration={0} onDismiss={onDismiss} />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('defaults to info when no tone is given', () => {
    render(<Toast message="Saved" onDismiss={() => {}} />)
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('info')
  })
})

describe('focus-trap edges', () => {
  function container(html: string): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-tmui-panel', '')
    el.innerHTML = html
    document.body.appendChild(el)
    return el
  }

  it('finds nothing focusable in an empty surface', () => {
    const el = container('<p>nothing here</p>')
    expect(focusableWithin(el)).toHaveLength(0)
    el.remove()
  })

  it('does not claim the key when there is nothing to move focus to', () => {
    const el = container('<p>nothing here</p>')
    expect(trapTab(el, false)).toBe(false)
    el.remove()
  })

  it('skips disabled controls, which cannot take focus', () => {
    const el = container('<button disabled>no</button><button>yes</button>')
    expect(focusableWithin(el)).toHaveLength(1)
    el.remove()
  })

  it('skips tabindex="-1", which is not in the tab order', () => {
    const el = container('<div tabindex="-1">no</div><button>yes</button>')
    expect(focusableWithin(el)).toHaveLength(1)
    el.remove()
  })

  it('leaves Tab alone in the middle of the order', () => {
    const el = container('<button>a</button><button>b</button><button>c</button>')
    const buttons = el.querySelectorAll('button')
    ;(buttons[1] as HTMLElement).focus()
    expect(trapTab(el, false)).toBe(false)
    el.remove()
  })

  it('leaves Shift+Tab alone in the middle of the order', () => {
    const el = container('<button>a</button><button>b</button><button>c</button>')
    const buttons = el.querySelectorAll('button')
    ;(buttons[1] as HTMLElement).focus()
    expect(trapTab(el, true)).toBe(false)
    el.remove()
  })

  it('pulls stray focus back in on Tab', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const el = container('<button>a</button><button>b</button>')
    expect(trapTab(el, false)).toBe(true)
    expect(el.contains(document.activeElement)).toBe(true)
    el.remove()
    outside.remove()
  })

  it('focuses the surface itself when it holds nothing focusable', () => {
    const el = container('<p>nothing</p>')
    el.tabIndex = -1
    captureFocus(el)
    expect(document.activeElement).toBe(el)
    el.remove()
  })

  // The obvious case: a row deleted by the very dialog that confirmed deleting it.
  it('does not throw when the opener has left the document', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const el = container('<button>a</button>')
    const restore = captureFocus(el)
    opener.remove()
    expect(() => restore()).not.toThrow()
    el.remove()
  })
})
