import { describe, it, expect, vi, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { dispatchChannel } from '@terminator/extension-sdk'

// electron-store costs the host 17 MB (docs/research/perf/2026-10-12-extension-host.md), so it
// loads when a channel first uses a store, not at activation. Vitest runs a vi.mock factory when
// the module is first imported, so `loaded` records it.

const loaded = vi.hoisted(() => ({ store: false }))

vi.mock('electron-store', () => {
  loaded.store = true
  return {
    default: class {
      store = {}
      get() {
        return undefined
      }
      set() {}
      delete() {}
    },
  }
})

let globalStorage = ''

afterEach(() => {
  rmSync(dirname(dirname(globalStorage)), { recursive: true, force: true })
})

describe('the stores', () => {
  it('are not loaded at activation, and are by the first channel that reads one', async () => {
    const { activateCapturingChannels, freshGlobalStorage } = await import('./support/activate')
    globalStorage = freshGlobalStorage()
    const { channels } = activateCapturingChannels(undefined, globalStorage)
    expect(loaded.store).toBe(false)

    const sessions = channels.find((c) => c.spec.channel === 'github:sessions-for-repo')!.spec
    await expect(dispatchChannel(sessions, { repoRoot: 'gh:acme/widgets' })).resolves.toEqual({
      sessions: [],
    })

    expect(loaded.store).toBe(true)
  })
})
