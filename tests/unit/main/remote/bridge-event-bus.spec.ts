import { describe, it, expect, vi } from 'vitest'
import { bridgeEventBus } from '../../../../src/main/remote/bridge-event-bus'

describe('bridgeEventBus', () => {
  it('does not emit MaxListenersExceededWarning when 11 listeners are added', () => {
    const warningSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const handlers: (() => void)[] = []
    for (let i = 0; i < 11; i++) {
      const fn = () => {}
      handlers.push(fn)
      bridgeEventBus.on('test:event', fn)
    }
    // Node passes the warning as an Error named MaxListenersExceededWarning, not
    // as a string, so the only reliable check is that nothing was emitted.
    expect(warningSpy).not.toHaveBeenCalled()
    for (const fn of handlers) bridgeEventBus.off('test:event', fn)
    warningSpy.mockRestore()
  })
})
