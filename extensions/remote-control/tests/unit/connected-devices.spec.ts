import { describe, it, expect, vi } from 'vitest'
import { ConnectedDeviceRegistry, deviceLabel } from '../../src/server/connected-devices'

// The server always knew who was connected; nothing surfaced it. A stale list
// is worse than none here — this is the surface that says who currently has
// shell access.

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1', 'iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1', 'iPad'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36', 'Android phone'],
    ['Mozilla/5.0 (Linux; Android 14; Tab) Safari/537.36', 'Android tablet'],
  ])('recognises %s as %s', (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected)
  })

  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36', 'Chrome on Mac'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17 Safari/605.1', 'Safari on Mac'],
    ['Mozilla/5.0 (Windows NT 10.0) Firefox/121.0', 'Firefox on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120', 'Edge on Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0', 'Firefox on Linux'],
  ])('names the browser and platform for %s', (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected)
  })

  // Chrome and Edge both claim Safari in their user agent, so order matters.
  it('does not mistake Chrome for Safari', () => {
    expect(deviceLabel('Macintosh Chrome/120 Safari/537.36')).toBe('Chrome on Mac')
  })

  it('does not mistake Edge for Chrome', () => {
    expect(deviceLabel('Windows Chrome/120 Safari/537.36 Edg/120')).toBe('Edge on Windows')
  })

  it('says so rather than guessing when it cannot tell', () => {
    expect(deviceLabel(undefined)).toBe('Unknown device')
    expect(deviceLabel('curl/8.1.2')).toBe('Unknown device')
  })

  // The screen this appears on also carries an access credential; a raw user
  // agent string is noise worth not printing there.
  it('never returns the raw user agent', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1'
    expect(deviceLabel(ua)).not.toContain('Mozilla')
  })
})

describe('ConnectedDeviceRegistry', () => {
  const clock = () => {
    let t = 1000
    return () => (t += 10)
  }

  it('starts empty', () => {
    const registry = new ConnectedDeviceRegistry(clock())
    expect(registry.list()).toEqual([])
    expect(registry.count()).toBe(0)
  })

  it('records a device with a recognisable label', () => {
    const registry = new ConnectedDeviceRegistry(clock())
    const device = registry.add('a', 'iPhone; CPU iPhone OS 17_0', 'ses-1')
    expect(device.label).toBe('iPhone')
    expect(device.viewing).toBe('ses-1')
    expect(registry.count()).toBe(1)
  })

  it('drops a device when it disconnects', () => {
    const registry = new ConnectedDeviceRegistry(clock())
    registry.add('a', 'iPhone', 'ses-1')
    registry.remove('a')
    expect(registry.count()).toBe(0)
  })

  it('ignores a disconnect for something it never had', () => {
    const registry = new ConnectedDeviceRegistry(clock())
    expect(() => registry.remove('ghost')).not.toThrow()
  })

  // A list that reorders as it grows makes the row you were about to
  // disconnect move under the pointer.
  it('keeps the oldest connection first', () => {
    const registry = new ConnectedDeviceRegistry(clock())
    registry.add('a', 'iPhone', 'ses-1')
    registry.add('b', 'iPad', 'ses-2')
    registry.add('c', 'Windows Firefox', 'ses-3')
    expect(registry.list().map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  describe('change signal', () => {
    it('fires when a device joins', () => {
      const registry = new ConnectedDeviceRegistry(clock())
      const seen = vi.fn()
      registry.onChange(seen)
      registry.add('a', 'iPhone', 'ses-1')
      expect(seen).toHaveBeenCalledTimes(1)
      expect(seen.mock.calls[0][0]).toHaveLength(1)
    })

    it('fires when a device leaves', () => {
      const registry = new ConnectedDeviceRegistry(clock())
      registry.add('a', 'iPhone', 'ses-1')
      const seen = vi.fn()
      registry.onChange(seen)
      registry.remove('a')
      expect(seen).toHaveBeenCalledTimes(1)
      expect(seen.mock.calls[0][0]).toEqual([])
    })

    it('does not fire for a disconnect that changed nothing', () => {
      const registry = new ConnectedDeviceRegistry(clock())
      const seen = vi.fn()
      registry.onChange(seen)
      registry.remove('ghost')
      expect(seen).not.toHaveBeenCalled()
    })

    it('stops after unsubscribing, so a closed view leaks nothing', () => {
      const registry = new ConnectedDeviceRegistry(clock())
      const seen = vi.fn()
      const off = registry.onChange(seen)
      off()
      registry.add('a', 'iPhone', 'ses-1')
      expect(seen).not.toHaveBeenCalled()
    })

    it('notifies every listener', () => {
      const registry = new ConnectedDeviceRegistry(clock())
      const a = vi.fn()
      const b = vi.fn()
      registry.onChange(a)
      registry.onChange(b)
      registry.add('x', 'iPad', 'ses-1')
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })
})

// "Disconnect" in the view has to reach the socket, or the button is decoration.
describe('disconnecting', () => {
  it('closes the connection it was given', () => {
    const registry = new ConnectedDeviceRegistry(() => 1000)
    const close = vi.fn()
    registry.add('a', 'iPhone', 'ses-1', close)
    expect(registry.disconnect('a')).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })

  // One source of truth: the socket closing is what removes the row, so a
  // failed disconnect leaves it visible rather than lying about it.
  it('does not remove the row itself', () => {
    const registry = new ConnectedDeviceRegistry(() => 1000)
    registry.add('a', 'iPhone', 'ses-1', () => {})
    registry.disconnect('a')
    expect(registry.count()).toBe(1)
  })

  it('reports failure for something it cannot close', () => {
    const registry = new ConnectedDeviceRegistry(() => 1000)
    registry.add('a', 'iPhone', 'ses-1')
    expect(registry.disconnect('a')).toBe(false)
    expect(registry.disconnect('ghost')).toBe(false)
  })

  it('forgets the closer once the socket is gone', () => {
    const registry = new ConnectedDeviceRegistry(() => 1000)
    const close = vi.fn()
    registry.add('a', 'iPhone', 'ses-1', close)
    registry.remove('a')
    expect(registry.disconnect('a')).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })
})
