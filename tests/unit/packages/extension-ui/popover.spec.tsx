import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Popover } from '../../../../packages/extension-ui/src/Popover'
import { isSurfaceOpen } from '../../../../src/shared/double-escape'

// aria-modal and a focus trap would be defects here: the view behind a popover stays live (research
// R10). Placement, the top layer and light dismiss are a browser's: the stories in
// packages/extension-ui/stories/Popover.stories.tsx prove those in Chromium.

function renderPopover(onDismiss = vi.fn()) {
  const utils = render(
    <Popover label="Pick a date" onDismiss={onDismiss}>
      <button type="button">Today</button>
      <button type="button">Tomorrow</button>
    </Popover>
  )
  return { ...utils, onDismiss }
}

describe('Popover', () => {
  it('takes an accessible name', () => {
    renderPopover()
    expect(screen.getByRole('group', { name: 'Pick a date' })).toBeTruthy()
  })

  it('is a native popover, shown as soon as it mounts', () => {
    renderPopover()
    const surface = screen.getByRole('group')
    expect(surface.getAttribute('popover')).toBe('auto')
    expect(surface.matches(':popover-open')).toBe(true)
  })
})

describe('Popover — light dismiss', () => {
  it('closes on Escape', () => {
    const { onDismiss } = renderPopover()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('closes on a click outside it', () => {
    const { onDismiss } = renderPopover()
    fireEvent.click(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not close on a click inside it', () => {
    const { onDismiss } = renderPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does not call onDismiss when the caller closes it by unmounting', () => {
    const { onDismiss, unmount } = renderPopover()
    unmount()
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('Popover — focus', () => {
  it('moves focus in, and returns it to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = renderPopover()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Today' }))

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  // The two things that separate it from a Dialog. Claiming the page is inert when it is not
  // misinforms assistive technology.
  it('does not claim the page is inert', () => {
    renderPopover()
    const surface = screen.getByRole('group')
    expect(surface.getAttribute('aria-modal')).toBeNull()
    expect(surface.getAttribute('role')).not.toBe('dialog')
  })

  it('does not trap Tab, because the view behind it is still usable', () => {
    renderPopover()
    const buttons = screen.getAllByRole('button')
    buttons[buttons.length - 1].focus()
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
  })
})

describe('Popover — the exit gesture reads it from the DOM', () => {
  it('is an open surface while mounted, and none after', () => {
    const { unmount } = renderPopover()
    expect(isSurfaceOpen(document)).toBe(true)
    unmount()
    expect(isSurfaceOpen(document)).toBe(false)
  })
})

/** jsdom reports a zero rect, so the geometry is stubbed: what is under test is the arithmetic and
 * which way a surface opened at a point is nudged back. */
function renderAtPoint(rect: Partial<DOMRect>) {
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
  render(
    <Popover label="Menu" at={{ x: 10, y: 20 }} onDismiss={vi.fn()}>
      <button>Item</button>
    </Popover>
  )
  spy.mockRestore()
  return screen.getByRole('group')
}

describe('Popover opened at a point', () => {
  it('sits at the point', () => {
    const surface = renderAtPoint({})
    expect(surface.style.left).toBe('10px')
    expect(surface.style.top).toBe('20px')
  })

  it('pulls back a surface overflowing the right edge', () => {
    const surface = renderAtPoint({ right: window.innerWidth + 40 })
    // 40 over, plus the 8px margin it keeps.
    expect(surface.style.marginLeft).toBe('-48px')
  })

  it('pulls up a surface overflowing the bottom edge', () => {
    const surface = renderAtPoint({ bottom: window.innerHeight + 20 })
    expect(surface.style.marginTop).toBe('-28px')
  })

  it('leaves a surface that already fits alone', () => {
    const surface = renderAtPoint({ right: 100, bottom: 100 })
    expect(surface.style.marginLeft).toBe('')
    expect(surface.style.marginTop).toBe('')
  })
})

// A press the window never saw released (a drag let go outside it) must not leave every later
// surface waiting for a release that will not come.
describe('Popover after a press whose release was missed', () => {
  it('opens at once from a context menu sent with no button held', () => {
    fireEvent.pointerDown(document.body)
    fireEvent.contextMenu(document.body, { buttons: 0 })
    renderPopover()
    expect(screen.getByRole('group').matches(':popover-open')).toBe(true)
  })

  it('opens at once after a click, which only comes once the button is up', () => {
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    renderPopover()
    expect(screen.getByRole('group').matches(':popover-open')).toBe(true)
  })

  it('still waits for the release when a context menu comes mid-press, as on macOS', () => {
    fireEvent.pointerDown(document.body)
    fireEvent.contextMenu(document.body, { buttons: 2 })
    renderPopover()
    const surface = screen.getByRole('group', { hidden: true })
    expect(surface.matches(':popover-open')).toBe(false)
    fireEvent.pointerUp(document.body)
    return expect.poll(() => surface.matches(':popover-open')).toBe(true)
  })
})
