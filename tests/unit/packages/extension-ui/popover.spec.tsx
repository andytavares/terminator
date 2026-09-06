import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Popover } from '../../../../packages/extension-ui/src/Popover'
import { MODAL_DEPTH_KEY } from '../../../../packages/extension-ui/src/modal-depth'

// A picker, a dropdown, a detail panel. The audit scored these against
// aria-modal and a focus trap and called them failing; both would be defects
// here, because the view behind a popover stays live (research R10).

function renderPopover(onDismiss = vi.fn()) {
  const utils = render(
    <Popover label="Pick a date" onDismiss={onDismiss}>
      <button type="button">Today</button>
      <button type="button">Tomorrow</button>
    </Popover>
  )
  return { ...utils, onDismiss }
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[MODAL_DEPTH_KEY]
})

describe('Popover', () => {
  it('takes an accessible name', () => {
    renderPopover()
    expect(screen.getByRole('group', { name: 'Pick a date' })).toBeTruthy()
  })

  it('closes on Escape', () => {
    const { onDismiss } = renderPopover()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('closes on a click outside it', async () => {
    const { onDismiss } = renderPopover()
    // The opening click is still propagating on the tick the popover mounts, so
    // the outside listener is attached one tick later.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    fireEvent.mouseDown(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not close on a click inside it', async () => {
    const { onDismiss } = renderPopover()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Today' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('moves focus in, and returns it to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = renderPopover()
    expect(document.activeElement).not.toBe(opener)

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  // The two things that separate it from a Dialog. Claiming the page is inert
  // when it is not misinforms assistive technology.
  it('does not claim the page is inert', () => {
    const { container } = renderPopover()
    const el = container.querySelector('.tmui-popover')!
    expect(el.getAttribute('aria-modal')).toBeNull()
    expect(el.getAttribute('role')).not.toBe('dialog')
  })

  it('does not trap Tab, because the view behind it is still usable', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { container } = renderPopover()
    const panel = container.querySelector('.tmui-popover') as HTMLElement
    const buttons = Array.from(panel.querySelectorAll('button'))
    buttons[buttons.length - 1].focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    // No handler intercepted it, so focus is left exactly where the browser
    // would take it rather than being wrapped back to the top.
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    outside.remove()
  })

  it('counts toward the open-surface depth so the exit gesture stands down', () => {
    const { unmount } = renderPopover()
    expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(1)
    unmount()
    expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(0)
  })

  it('stacks above a plain page, on the published overlay layer', () => {
    const { container } = renderPopover()
    const el = container.querySelector('.tmui-popover') as HTMLElement
    expect(Number(el.style.zIndex)).toBeGreaterThan(0)
  })
})

/**
 * Staying on screen.
 *
 * The surface is positioned against whatever anchored it, so a control near an
 * edge — the caret beside the commit button — put half the menu outside the
 * window with nothing to scroll. jsdom reports a zero rect, so the geometry is
 * stubbed: what is under test is the arithmetic and which way it nudges.
 */
describe('Popover viewport clamping', () => {
  function renderWithRect(rect: Partial<DOMRect>) {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect)
    const view = render(
      <Popover label="Menu" onDismiss={vi.fn()}>
        <button>Item</button>
      </Popover>
    )
    spy.mockRestore()
    return view.container.querySelector('[data-tmui-surface]') as HTMLElement
  }

  it('pulls back a surface overflowing the right edge', () => {
    const el = renderWithRect({ right: window.innerWidth + 40 })
    // 40 over, plus the 8px margin it keeps.
    expect(el.style.marginLeft).toBe('-48px')
  })

  it('pulls up a surface overflowing the bottom edge', () => {
    const el = renderWithRect({ bottom: window.innerHeight + 20 })
    expect(el.style.marginTop).toBe('-28px')
  })

  it('leaves a surface that already fits alone', () => {
    const el = renderWithRect({ right: 100, bottom: 100 })
    expect(el.style.marginLeft).toBe('')
    expect(el.style.marginTop).toBe('')
  })
})
