import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

import { registerFsHandlers } from '../../../src/main/ipc/fs.ipc'

function fakeWindow(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } }
}

let window: ReturnType<typeof fakeWindow> | null
// The watcher service is a singleton that keeps every handler added to it, so register once.
registerFsHandlers(() => window as never)

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return Promise.resolve(handlers.get(channel)!({}, payload)) as Promise<T>
}

/** Long enough for a watch event to have arrived, for asserting one did not. */
const quiet = () => new Promise((r) => setTimeout(r, 300))

let projectRoot: string

beforeEach(() => {
  window = fakeWindow()
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-ipc-'))
})

afterEach(async () => {
  await invoke('fs:watch-stop')
})

describe('fs:watch-start / fs:watch-stop', () => {
  it('tells the window about a file that changes in the project', async () => {
    expect(await invoke('fs:watch-start', { projectRoot })).toEqual({ ok: true })
    fs.writeFileSync(path.join(projectRoot, 'a.ts'), 'x')
    await vi.waitFor(() =>
      expect(window!.webContents.send).toHaveBeenCalledWith(
        'fs:changed',
        expect.objectContaining({ projectRoot, filename: 'a.ts' })
      )
    )
  })

  it('says nothing once watching has stopped', async () => {
    await invoke('fs:watch-start', { projectRoot })
    expect(await invoke('fs:watch-stop')).toEqual({ ok: true })
    fs.writeFileSync(path.join(projectRoot, 'a.ts'), 'x')
    await quiet()
    expect(window!.webContents.send).not.toHaveBeenCalled()
  })

  it('sends nothing to a window that has closed', async () => {
    window = fakeWindow(true)
    await invoke('fs:watch-start', { projectRoot })
    fs.writeFileSync(path.join(projectRoot, 'a.ts'), 'x')
    await quiet()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})

describe('fs:read-file', () => {
  it('returns the file’s content', async () => {
    const filePath = path.join(projectRoot, 'file.ts')
    fs.writeFileSync(filePath, 'file contents')
    expect(await invoke('fs:read-file', { filePath })).toEqual({ content: 'file contents' })
  })

  it('returns FILE_NOT_FOUND for a file that is not there', async () => {
    const filePath = path.join(projectRoot, 'missing.ts')
    expect(await invoke('fs:read-file', { filePath })).toEqual({ error: 'FILE_NOT_FOUND' })
  })
})
