import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  installIconTooltips,
  TOOLTIP_DELAY_MS,
} from '../../../../packages/extension-ui/src/icon-tooltips'

// jsdom has no Popover API; the tooltip only needs the calls to exist.
HTMLElement.prototype.showPopover = function () {}
HTMLElement.prototype.hidePopover = function () {}

let removeTooltips: () => void

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = `
    <button id="backlog" aria-label="Send to backlog"><svg aria-hidden="true"></svg></button>
    <button id="archive" title="Archive task" aria-label="Archive"><svg></svg></button>
    <button id="save">Save</button>
    <button id="describe" aria-label="Save description">Save description</button>
    <button id="inbox" aria-label="Inbox"><svg></svg><span>3</span></button>`
  removeTooltips = installIconTooltips(document)
})

afterEach(() => {
  removeTooltips()
  vi.useRealTimers()
})

function tooltip(): HTMLElement | null {
  const shown = document.querySelector<HTMLElement>('.tmui-tooltip')
  return shown && !shown.hidden ? shown : null
}

function hover(id: string): HTMLElement {
  const control = document.getElementById(id)!
  // The pointer lands on the icon inside the button, or on a text button itself.
  const target = control.querySelector('svg') ?? control
  target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  return control
}

describe('installIconTooltips — pointer', () => {
  it('names an icon-only control after the pointer rests on it, from its aria-label', () => {
    hover('backlog')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1)
    expect(tooltip()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(tooltip()?.textContent).toBe('Send to backlog')
  })

  it('prefers the title, and holds it back so the native tooltip does not draw a second', () => {
    const control = hover('archive')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    expect(tooltip()?.textContent).toBe('Archive task')
    expect(control.hasAttribute('title')).toBe(false)

    control.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    expect(tooltip()).toBeNull()
    expect(control.getAttribute('title')).toBe('Archive task')
  })
})

describe('installIconTooltips — which controls', () => {
  it('leaves a control alone when its visible text already says its name', () => {
    hover('save')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    expect(tooltip()).toBeNull()
    hover('describe')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    expect(tooltip()).toBeNull()
  })

  it('names an icon that carries a badge count', () => {
    hover('inbox')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    expect(tooltip()?.textContent).toBe('Inbox')
  })

  it('stops showing once uninstalled', () => {
    removeTooltips()
    hover('backlog')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    expect(document.querySelector('.tmui-tooltip')).toBeNull()
    removeTooltips = () => {}
  })
})

describe('installIconTooltips — keyboard', () => {
  it('names a control as soon as it takes focus, and goes when focus leaves', () => {
    const control = document.getElementById('backlog')!
    control.focus()
    expect(tooltip()?.textContent).toBe('Send to backlog')
    control.blur()
    expect(tooltip()).toBeNull()
  })

  it('stays while focus moves between other elements', () => {
    const field = document.body.appendChild(document.createElement('input'))
    field.focus()
    hover('backlog')
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    field.blur()
    expect(tooltip()?.textContent).toBe('Send to backlog')
  })

  it('stays away when a click is what focused the control', () => {
    const control = document.getElementById('backlog')!
    control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    control.focus()
    expect(tooltip()).toBeNull()
  })

  it('goes on Escape', () => {
    document.getElementById('backlog')!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(tooltip()).toBeNull()
  })
})
