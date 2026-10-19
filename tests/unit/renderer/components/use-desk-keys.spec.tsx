import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type React from 'react'
import { useDeskKeys } from '../../../../src/renderer/components/home/use-desk-keys'

function keyDownOn(element: Element, key: string) {
  const preventDefault = vi.fn()
  return {
    event: { key, target: element, preventDefault } as unknown as React.KeyboardEvent,
    preventDefault,
  }
}

describe('useDeskKeys', () => {
  it('leaves Enter on a button to the button, so a drawer button still presses', () => {
    const onCommand = vi.fn()
    const { result } = renderHook(() => useDeskKeys(onCommand))
    const { event, preventDefault } = keyDownOn(document.createElement('button'), 'Enter')
    result.current(event)
    expect(onCommand).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('still opens the row on Enter from a row', () => {
    const onCommand = vi.fn()
    const { result } = renderHook(() => useDeskKeys(onCommand))
    result.current(keyDownOn(document.createElement('div'), 'Enter').event)
    expect(onCommand).toHaveBeenCalledWith({ kind: 'open' })
  })
})
