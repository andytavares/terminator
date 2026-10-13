import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcRendererEvent } from 'electron'
import { partialFake } from '../../support/fakes'

const exposed: Record<string, unknown> = {}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value
    },
  },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))

type Api = Record<string, Record<string, (handler: () => void) => () => void>>

describe('preload — the surface pop-out windows get', () => {
  beforeEach(async () => {
    vi.resetModules()
    await import('../../../src/main/preload.js')
  })

  // api.window.openAuxiliary loads an extension's own view into a BrowserWindow
  // with this preload, so a view that follows setting changes must find the
  // subscription here too, or it throws while mounting and the window is blank.
  it('calls an extension view back when a setting changes', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.on).mockClear()
    const handler = vi.fn()

    const api = exposed['electronAPI'] as Api
    api.extension.onSettingsChanged(handler)
    const [channel, listener] = vi.mocked(ipcRenderer.on).mock.calls[0]
    listener(partialFake<IpcRendererEvent>({}), null)

    expect(channel).toBe('extension:settings-changed')
    expect(handler).toHaveBeenCalledOnce()
  })
})
