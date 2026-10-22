import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  announce,
  announceWindowReadiness,
  resetAnnouncements,
  whenAnnounced,
} from '../../../src/main/e2e-readiness'

class FakeWindow extends EventEmitter {
  id = 7
  debuggerCommands: Array<[string, unknown]> = []
  webContents = {
    debugger: {
      isAttached: () => false,
      attach: vi.fn(),
      sendCommand: vi.fn(async (method: string, params: unknown) => {
        this.debuggerCommands.push([method, params])
      }),
    },
  }
}

async function settles(promise: Promise<void>): Promise<boolean> {
  const marker = Symbol('pending')
  const outcome = await Promise.race([promise, Promise.resolve(marker)])
  return outcome !== marker
}

describe('the e2e readiness announcer', () => {
  beforeEach(() => {
    process.env.TERMINATOR_E2E = '1'
    resetAnnouncements()
  })
  afterEach(() => {
    delete process.env.TERMINATOR_E2E
  })

  it('answers a wait that began before the announcement', async () => {
    const waiting = whenAnnounced('drawn', '7')
    expect(await settles(waiting)).toBe(false)
    announce('drawn', '7')
    await expect(waiting).resolves.toBeUndefined()
  })

  it('answers a wait that began after the announcement', async () => {
    announce('ready', 'task-vault:board')
    await expect(whenAnnounced('ready', 'task-vault:board')).resolves.toBeUndefined()
  })

  it('keeps announcements of other kinds and subjects apart', async () => {
    announce('drawn', '7')
    expect(await settles(whenAnnounced('focused', '7'))).toBe(false)
    expect(await settles(whenAnnounced('drawn', '8'))).toBe(false)
  })
})

describe('the e2e readiness of a window', () => {
  beforeEach(() => {
    process.env.TERMINATOR_E2E = '1'
    resetAnnouncements()
  })
  afterEach(() => {
    delete process.env.TERMINATOR_E2E
  })

  it('announces a window drawn at its first frame and focused once emulation is on', async () => {
    const window = new FakeWindow()
    announceWindowReadiness(window as never)
    expect(await settles(whenAnnounced('drawn', '7'))).toBe(false)
    window.emit('ready-to-show')
    await whenAnnounced('drawn', '7')
    await whenAnnounced('focused', '7')
    expect(window.debuggerCommands).toEqual([
      ['Emulation.setFocusEmulationEnabled', { enabled: true }],
    ])
  })

  it('is inert, and a wait fails fast, when the variable is unset', async () => {
    delete process.env.TERMINATOR_E2E
    const window = new FakeWindow()
    announceWindowReadiness(window as never)
    window.emit('ready-to-show')
    expect(window.webContents.debugger.attach).not.toHaveBeenCalled()
    await expect(whenAnnounced('drawn', '7')).rejects.toThrow('TERMINATOR_E2E')
  })
})

describe('the e2e readiness of a window whose focus emulation fails', () => {
  beforeEach(() => {
    process.env.TERMINATOR_E2E = '1'
    resetAnnouncements()
  })
  afterEach(() => {
    delete process.env.TERMINATOR_E2E
  })

  it('fails the wait for focus, with the reason, when focus emulation cannot start', async () => {
    const window = new FakeWindow()
    window.webContents.debugger.attach.mockImplementation(() => {
      throw new Error('Another debugger is already attached')
    })
    announceWindowReadiness(window as never)
    await expect(whenAnnounced('focused', '7')).rejects.toThrow('Another debugger')
  })
})
