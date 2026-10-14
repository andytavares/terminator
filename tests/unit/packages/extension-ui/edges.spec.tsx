import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FileText } from 'lucide-react'
import { IconButton } from '../../../../packages/extension-ui/src/IconButton'
import { Popover } from '../../../../packages/extension-ui/src/Popover'
import { Toast } from '../../../../packages/extension-ui/src/Toast'

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

  it('keeps the label as the name and shows a longer description as the tooltip', () => {
    render(
      <IconButton
        icon={FileText}
        label="Mute run-1"
        description="Stop this run interrupting, without hiding what it does"
        onClick={() => {}}
      />
    )
    const button = screen.getByRole('button', { name: 'Mute run-1' })
    expect(button.getAttribute('title')).toBe(
      'Stop this run interrupting, without hiding what it does'
    )
  })
})

describe('IconButton edges — reports the unpressed state of a toggle', () => {
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
})

describe('Popover edges — leaves the outer surface alone when Escape reaches a nested one', () => {
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
})

describe('Toast edges — treats a zero duration as sticky', () => {
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
