import { describe, it, expect, vi } from 'vitest'

const constructed: Array<Record<string, unknown>> = []

vi.mock('electron-store', () => ({
  default: class MockStore {
    constructor(options: Record<string, unknown>) {
      constructed.push(options)
      Object.assign(this, { data: { ...(options.defaults as Record<string, unknown>) } })
    }
    get(key: string): unknown {
      return (this as unknown as { data: Record<string, unknown> }).data[key]
    }
    set(key: string, value: unknown): void {
      ;(this as unknown as { data: Record<string, unknown> }).data[key] = value
    }
  },
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

// The defaults here are load-bearing, not cosmetic: shadow mode defaulting to
// anything but `true` would let an unproven stall detector act on a brand new
// install (FR-018).

describe('the supervision store', () => {
  it('defaults shadow mode on, so a new install never acts on an unproven stall', async () => {
    const { supervisionStore } = await import('../../../src/main/storage/supervision-store')
    expect(supervisionStore.get('stallShadowMode')).toBe(true)
  })

  it('starts with an empty registry and no lane bindings', async () => {
    const { supervisionStore } = await import('../../../src/main/storage/supervision-store')
    expect(supervisionStore.get('sessions')).toEqual({})
    expect(supervisionStore.get('laneBindings')).toEqual({})
  })

  it('holds no editor command — that is a global setting the operator can reach', async () => {
    // It lived here and nothing ever wrote it, so the handoff could never be
    // configured. It is in Settings → Supervision now.
    const { supervisionStore } = await import('../../../src/main/storage/supervision-store')
    expect(supervisionStore.get('externalEditor' as never)).toBeUndefined()
  })

  it('lives in its own file rather than the app settings blob', async () => {
    await import('../../../src/main/storage/supervision-store')
    expect(constructed[0].name).toBe('supervision')
  })

  it('persists what it is given', async () => {
    const { supervisionStore } = await import('../../../src/main/storage/supervision-store')
    supervisionStore.set('stallShadowMode', false)
    expect(supervisionStore.get('stallShadowMode')).toBe(false)
    supervisionStore.set('stallShadowMode', true)
  })
})
