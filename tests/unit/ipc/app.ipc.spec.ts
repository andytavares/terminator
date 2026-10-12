import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
const showOpenDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
  app: {
    getName: () => 'Terminator',
    getVersion: () => '9.9.9',
    getPath: (name: string) => (name === 'home' ? '/Users/someone' : '/tmp'),
  },
  dialog: { showOpenDialog: (...a: unknown[]) => showOpenDialog(...a) },
}))

function handlerFor(channel: string): (event: unknown, payload?: unknown) => unknown {
  const match = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

const window = { id: 1 }
let mainWindow: typeof window | null

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mainWindow = window
  const { registerAppInfoHandlers, registerDialogHandlers } = await import(
    '../../../src/main/ipc/app.ipc.js'
  )
  registerAppInfoHandlers()
  registerDialogHandlers(() => mainWindow as never)
})

describe('app:get-info', () => {
  it('reports the app name, version, runtime versions and home directory', async () => {
    const info = (await handlerFor('app:get-info')(null, undefined)) as Record<string, string>
    expect(info).toMatchObject({
      appName: 'Terminator',
      version: '9.9.9',
      nodeVersion: process.versions.node,
      platform: process.platform,
      homeDir: '/Users/someone',
    })
  })
})

describe('dialog:open-directory', () => {
  it('returns the folder the user picked', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/repos/app'] })
    expect(await handlerFor('dialog:open-directory')(null, undefined)).toEqual({
      filePath: '/repos/app',
    })
    expect(showOpenDialog).toHaveBeenCalledWith(window, { properties: ['openDirectory'] })
  })

  it('reports a cancelled dialog as cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await handlerFor('dialog:open-directory')(null, undefined)).toEqual({
      cancelled: true,
    })
  })

  it('does not open a dialog when there is no window to own it', async () => {
    mainWindow = null
    expect(await handlerFor('dialog:open-directory')(null, undefined)).toEqual({
      cancelled: true,
    })
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})
