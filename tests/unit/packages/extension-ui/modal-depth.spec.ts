import { describe, it, expect, beforeEach } from 'vitest'
import {
  createModalDepthRegistry,
  getModalDepth,
  MODAL_DEPTH_KEY,
} from '../../../../packages/extension-ui/src/modal-depth'

// Depth is tracked per document, not across the process boundary: a dialog and
// the double-Escape detector that must yield to it both live in the same view,
// so the count never has to travel (research R2).

describe('modal depth registry', () => {
  let host: Record<string, unknown>

  beforeEach(() => {
    host = {}
  })

  it('starts at zero', () => {
    const registry = createModalDepthRegistry(host)
    expect(registry.current()).toBe(0)
  })

  it('counts an open surface', () => {
    const registry = createModalDepthRegistry(host)
    registry.push()
    expect(registry.current()).toBe(1)
  })

  it('counts nested surfaces', () => {
    const registry = createModalDepthRegistry(host)
    registry.push()
    registry.push()
    expect(registry.current()).toBe(2)
  })

  it('releases on close', () => {
    const registry = createModalDepthRegistry(host)
    registry.push()
    registry.pop()
    expect(registry.current()).toBe(0)
  })

  // A stuck count silently disables the exit gesture for the rest of the
  // session, which is worse than the bug being fixed.
  it('floors at zero when popped more than pushed', () => {
    const registry = createModalDepthRegistry(host)
    registry.pop()
    registry.pop()
    expect(registry.current()).toBe(0)
  })

  // release() takes the count itself, so a component that unmounts twice — or
  // whose cleanup runs after an error boundary already tore it down — must not
  // release more than it took, or the exit gesture stays suppressed for good.
  it('releases the same count it took even when a surface unmounts twice', () => {
    const registry = createModalDepthRegistry(host)
    const release = registry.release()
    expect(registry.current()).toBe(1)
    release()
    release()
    expect(registry.current()).toBe(0)
  })

  it('does not release a count another surface is holding', () => {
    const registry = createModalDepthRegistry(host)
    const releaseOuter = registry.release()
    const releaseInner = registry.release()
    expect(registry.current()).toBe(2)
    releaseInner()
    releaseInner()
    expect(registry.current()).toBe(1)
    releaseOuter()
    expect(registry.current()).toBe(0)
  })

  it('publishes the count on the host object so a preload script can read it', () => {
    const registry = createModalDepthRegistry(host)
    registry.push()
    expect(host[MODAL_DEPTH_KEY]).toBe(1)
    registry.pop()
    expect(host[MODAL_DEPTH_KEY]).toBe(0)
  })

  it('shares one count between every registry over the same host', () => {
    const a = createModalDepthRegistry(host)
    const b = createModalDepthRegistry(host)
    a.push()
    expect(b.current()).toBe(1)
  })

  describe('getModalDepth', () => {
    it('reads the published count', () => {
      const registry = createModalDepthRegistry(host)
      registry.push()
      expect(getModalDepth(host)).toBe(1)
    })

    // The detector runs in a preload context that may load before any dialog
    // has ever mounted; an absent count means nothing is open, not a crash.
    it('reports zero when nothing has ever registered', () => {
      expect(getModalDepth({})).toBe(0)
    })

    it('reports zero for a host with a nonsense value', () => {
      expect(getModalDepth({ [MODAL_DEPTH_KEY]: 'not a number' })).toBe(0)
    })

    it('reports zero when there is no host at all', () => {
      expect(getModalDepth(undefined)).toBe(0)
    })
  })
})

// Extension views run with contextIsolation, so the preload's window is not the
// page's window. The count the preload's Escape detector reads has to be handed
// over the bridge explicitly — publishing it on the page's window is invisible
// to the isolated world.
describe('crossing the context bridge', () => {
  it('reports each change to the bridge when one is present', () => {
    const reported: number[] = []
    const host = { electronAPI: { ui: { setModalDepth: (d: number) => reported.push(d) } } }
    const registry = createModalDepthRegistry(host as unknown as Record<string, unknown>)
    registry.push()
    registry.push()
    registry.pop()
    expect(reported).toEqual([1, 2, 1])
  })

  it('works normally when no bridge is exposed', () => {
    const registry = createModalDepthRegistry({})
    registry.push()
    expect(registry.current()).toBe(1)
  })

  it('does not let a throwing bridge take the dialog down with it', () => {
    const host = {
      electronAPI: {
        ui: {
          setModalDepth: () => {
            throw new Error('bridge is gone')
          },
        },
      },
    }
    const registry = createModalDepthRegistry(host as unknown as Record<string, unknown>)
    expect(() => registry.push()).not.toThrow()
    expect(registry.current()).toBe(1)
  })
})
