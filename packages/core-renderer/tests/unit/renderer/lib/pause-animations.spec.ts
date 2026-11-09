// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'

import { installAnimationPause } from '../../../../src/lib/pause-animations'

const isIdle = (): boolean => document.documentElement.hasAttribute('data-window-idle')

let uninstall: (() => void) | undefined

afterEach(() => {
  uninstall?.()
  uninstall = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('installAnimationPause', () => {
  it('marks the window idle when it loses focus, and active again when it gets it back', () => {
    uninstall = installAnimationPause()
    window.dispatchEvent(new FocusEvent('blur'))
    expect(isIdle()).toBe(true)
    window.dispatchEvent(new FocusEvent('focus'))
    expect(isIdle()).toBe(false)
  })

  it('marks the window idle while it is hidden', () => {
    uninstall = installAnimationPause()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(isIdle()).toBe(true)
  })

  it('keeps the window active when focus moves into an extension view', () => {
    uninstall = installAnimationPause()
    const frame = document.createElement('iframe')
    document.body.append(frame)
    frame.focus()
    window.dispatchEvent(new FocusEvent('blur'))
    expect(isIdle()).toBe(false)
  })
})
