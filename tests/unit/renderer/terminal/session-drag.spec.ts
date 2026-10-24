// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type React from 'react'
import {
  SESSION_DRAG_TYPE,
  beginSessionDrag,
  draggedSession,
  endSessionDrag,
  finishSessionDrag,
  isSessionDrag,
  shouldBreakOut,
} from '../../../../src/renderer/terminal/session-drag'
import { partialFake } from '../../../support/fakes'
import { installElectronApi } from '../../../support/electron-api'

const breakOut = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/breakout', () => ({ breakOut }))

const outside = { outside: true, x: 640, y: 120 }
const inside = { outside: false, x: 10, y: 10 }

afterEach(() => endSessionDrag())

describe('shouldBreakOut', () => {
  it.each([
    ['none', outside, true],
    ['none', inside, false],
    ['move', outside, false],
    ['copy', outside, false],
    ['move', inside, false],
  ] as const)('dropEffect %s with the pointer %o gives %s', (dropEffect, pointer, expected) => {
    expect(shouldBreakOut({ dropEffect, pointer })).toBe(expected)
  })
})

describe('beginSessionDrag', () => {
  it('sets the custom type, never plain text, and remembers the session', () => {
    const setData = vi.fn()
    const event = partialFake<React.DragEvent>({
      dataTransfer: partialFake<DataTransfer>({ setData }),
    })
    beginSessionDrag(event, 's7')
    expect(setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 's7')
    expect(setData).not.toHaveBeenCalledWith('text/plain', expect.anything())
    expect(draggedSession()).toBe('s7')
  })
})

describe('isSessionDrag', () => {
  it('is true only for a drag carrying the session type', () => {
    const dragOf = (types: string[]) =>
      partialFake<React.DragEvent>({ dataTransfer: partialFake<DataTransfer>({ types }) })
    expect(isSessionDrag(dragOf([SESSION_DRAG_TYPE]))).toBe(true)
    expect(isSessionDrag(dragOf(['Files']))).toBe(false)
  })
})

/** Starts a drag of the session's tab, as a dragstart on it does. */
const startDragOf = (sessionId: string) =>
  beginSessionDrag(
    partialFake<React.DragEvent>({ dataTransfer: partialFake<DataTransfer>({ setData: vi.fn() }) }),
    sessionId
  )

describe('finishSessionDrag', () => {
  const pointerOutside = vi.fn()
  beforeEach(() => {
    breakOut.mockClear()
    installElectronApi({ breakout: { pointerOutside } })
  })

  it('moves the terminal to a window at the pointer when it was dropped on nothing', async () => {
    pointerOutside.mockResolvedValue(outside)
    startDragOf('s1')
    await finishSessionDrag('s1', 'none')
    expect(breakOut).toHaveBeenCalledWith('s1', { x: 640, y: 120 })
    expect(draggedSession()).toBeNull()
  })

  it('leaves the terminal alone when it was dropped on a Terminator window', async () => {
    pointerOutside.mockResolvedValue(inside)
    await finishSessionDrag('s1', 'none')
    expect(breakOut).not.toHaveBeenCalled()
  })
})
