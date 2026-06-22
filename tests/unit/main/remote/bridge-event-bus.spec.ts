import { describe, it, expect } from 'vitest'
import { bridgeEventBus } from '../../../../src/main/remote/bridge-event-bus'

describe('bridgeEventBus', () => {
  it('has maxListeners set to a value that allows 11+ subscribers without warning', () => {
    expect(bridgeEventBus.getMaxListeners()).toBeGreaterThanOrEqual(11)
  })

  it('does not emit MaxListenersExceededWarning when 11 listeners are added', () => {
    const warningSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const handlers: (() => void)[] = []
    for (let i = 0; i < 11; i++) {
      const fn = () => {}
      handlers.push(fn)
      bridgeEventBus.on('test:event', fn)
    }
    expect(warningSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('MaxListenersExceededWarning')
    )
    for (const fn of handlers) bridgeEventBus.off('test:event', fn)
    warningSpy.mockRestore()
  })
})
