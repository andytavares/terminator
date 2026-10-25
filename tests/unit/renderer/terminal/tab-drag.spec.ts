// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type React from 'react'
import {
  beginTabDrag,
  isOverTerminatorWindow,
  useTabDragStore,
  windowContains,
} from '../../../../src/renderer/terminal/tab-drag'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { partialFake } from '../../../support/fakes'
import { resetStore } from '../../../support/renderer-stores'

const mainWindow = { screenX: 100, screenY: 50, outerWidth: 1280, outerHeight: 800 }

function placeMainWindow(): void {
  for (const [key, value] of Object.entries(mainWindow)) {
    Object.defineProperty(window, key, { value, configurable: true })
  }
}

/** Two tabs in a strip, each naming its session the way the tab bar marks them. */
function tabStrip(): { first: HTMLElement; second: HTMLElement } {
  document.body.innerHTML =
    '<div data-session-tab="s1">one</div><div data-session-tab="s2">two</div>'
  const [first, second] = [...document.querySelectorAll<HTMLElement>('[data-session-tab]')]
  return { first, second }
}

let underPointer: Element | null = null

function pointer(type: string, target: EventTarget, at: { x: number; y: number }): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    screenX: at.x,
    screenY: at.y,
    clientX: at.x - mainWindow.screenX,
    clientY: at.y - mainWindow.screenY,
  })
  target.dispatchEvent(event)
  return event
}

/** Presses on the tab the way React hands a pointerdown to the tab's handler. */
function pressOn(tab: HTMLElement, { onDrop = vi.fn(), button = 0 } = {}) {
  const at = { x: 300, y: 70 }
  const event = partialFake<React.PointerEvent<HTMLElement>>({
    button,
    pointerId: 1,
    screenX: at.x,
    screenY: at.y,
    currentTarget: tab,
  })
  beginTabDrag(event, tab.dataset.sessionTab!, onDrop)
  return onDrop
}

beforeEach(() => {
  placeMainWindow()
  resetStore(useBreakoutStore, { windows: new Map() })
  useTabDragStore.setState({ sessionId: null, overSessionId: null, overMainWindow: false })
  underPointer = null
  document.elementFromPoint = () => underPointer
  HTMLElement.prototype.setPointerCapture = vi.fn()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('windowContains', () => {
  it.each([
    [{ x: 100, y: 50 }, true],
    [{ x: 1379, y: 849 }, true],
    [{ x: 1380, y: 300 }, false],
    [{ x: 99, y: 300 }, false],
    [{ x: 500, y: 850 }, false],
  ])('the window at 100,50 sized 1280x800 contains %o: %s', (point, expected) => {
    expect(windowContains(mainWindow, point)).toBe(expected)
  })
})

describe('isOverTerminatorWindow', () => {
  it('is true over the main window', () => {
    expect(isOverTerminatorWindow({ x: 700, y: 400 })).toBe(true)
  })

  it('is true over a terminal that lives in its own window', () => {
    const own = partialFake<Window>({
      screenX: 1500,
      screenY: 0,
      outerWidth: 600,
      outerHeight: 400,
    })
    resetStore(useBreakoutStore, { windows: new Map([['s9', own]]) })
    expect(isOverTerminatorWindow({ x: 1600, y: 100 })).toBe(true)
  })

  it('is false over the desktop', () => {
    expect(isOverTerminatorWindow({ x: 20, y: 400 })).toBe(false)
  })
})

describe('beginTabDrag — a click is not a drag', () => {
  it('drops nothing and leaves the drag state idle when the pointer barely moves', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', first, { x: 302, y: 71 })
    pointer('pointerup', first, { x: 302, y: 71 })
    expect(onDrop).not.toHaveBeenCalled()
    expect(useTabDragStore.getState().sessionId).toBeNull()
  })

  it('ignores a press with any button but the primary one', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first, { button: 2 })
    pointer('pointermove', first, { x: 20, y: 400 })
    pointer('pointerup', first, { x: 20, y: 400 })
    expect(onDrop).not.toHaveBeenCalled()
  })
})

describe('beginTabDrag — while dragging', () => {
  it('names the dragged session and the tab under the pointer', () => {
    const { first, second } = tabStrip()
    pressOn(first)
    underPointer = second
    pointer('pointermove', first, { x: 400, y: 70 })
    expect(useTabDragStore.getState()).toMatchObject({
      sessionId: 's1',
      overSessionId: 's2',
      overMainWindow: true,
    })
  })

  it('knows when the pointer has left the main window', () => {
    const { first } = tabStrip()
    pressOn(first)
    pointer('pointermove', first, { x: 20, y: 400 })
    expect(useTabDragStore.getState()).toMatchObject({ sessionId: 's1', overMainWindow: false })
  })
})

describe('beginTabDrag — the pointer', () => {
  it('captures the pointer once it is a drag, so a release outside the window still reaches it', () => {
    const { first } = tabStrip()
    pressOn(first)
    pointer('pointermove', first, { x: 301, y: 70 })
    expect(first.setPointerCapture).not.toHaveBeenCalled()
    pointer('pointermove', first, { x: 400, y: 70 })
    expect(first.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('follows a pointer that left the tab before the drag began', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', document.body, { x: 400, y: 90 })
    pointer('pointerup', document.body, { x: 20, y: 400 })
    expect(onDrop).toHaveBeenCalledWith({ x: 20, y: 400 }, null)
  })
})

describe('beginTabDrag — the release', () => {
  it('drops at once with the release point and the tab under it, and goes idle', () => {
    const { first, second } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', first, { x: 400, y: 70 })
    underPointer = second
    pointer('pointerup', first, { x: 410, y: 72 })
    expect(onDrop).toHaveBeenCalledWith({ x: 410, y: 72 }, 's2')
    expect(useTabDragStore.getState()).toMatchObject({ sessionId: null, overSessionId: null })
  })

  it('drops with no tab when released outside the window', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', first, { x: 40, y: 300 })
    pointer('pointerup', first, { x: 20, y: 400 })
    expect(onDrop).toHaveBeenCalledWith({ x: 20, y: 400 }, null)
  })
})

describe('beginTabDrag — after the release', () => {
  it('swallows the click that follows the release, so the drop is not also a tab click', () => {
    const { first } = tabStrip()
    pressOn(first)
    const clicked = vi.fn()
    document.addEventListener('click', clicked)
    pointer('pointermove', first, { x: 400, y: 70 })
    pointer('pointerup', first, { x: 400, y: 70 })
    first.click()
    expect(clicked).not.toHaveBeenCalled()
    first.click()
    expect(clicked).toHaveBeenCalledTimes(1)
    document.removeEventListener('click', clicked)
  })

  it('stops listening once dropped: a later move or release does nothing', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', first, { x: 400, y: 70 })
    pointer('pointerup', first, { x: 400, y: 70 })
    pointer('pointermove', first, { x: 20, y: 400 })
    pointer('pointerup', first, { x: 20, y: 400 })
    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(useTabDragStore.getState().sessionId).toBeNull()
  })
})

describe('beginTabDrag — cancelling', () => {
  it('Escape ends the drag without a drop', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', first, { x: 20, y: 400 })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    pointer('pointerup', first, { x: 20, y: 400 })
    expect(onDrop).not.toHaveBeenCalled()
    expect(useTabDragStore.getState().sessionId).toBeNull()
  })

  it('a pointercancel ends the drag without a drop', () => {
    const { first } = tabStrip()
    const onDrop = pressOn(first)
    pointer('pointermove', first, { x: 20, y: 400 })
    pointer('pointercancel', first, { x: 20, y: 400 })
    pointer('pointerup', first, { x: 20, y: 400 })
    expect(onDrop).not.toHaveBeenCalled()
    expect(useTabDragStore.getState().sessionId).toBeNull()
  })
})
