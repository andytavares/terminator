import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { buildElectronApi, type ApiTransport } from '../shared/electron-api/build-api.js'

// The electronAPI surface is declared once in src/shared/electron-api/manifest.ts;
// this file only supplies the native transport (ipcRenderer) and the handful of
// implementations that must run in the preload context.
//
// Bundling note: the shared manifest/builder are inlined into this entry by the
// preload build. Do NOT import them from preload-webview.ts as well — two preload
// entries sharing a module would make Rollup emit a shared chunk, which Electron's
// sandboxed require cannot resolve.

const RESERVED_SHORTCUTS = new Set([
  'CmdOrCtrl+1',
  'CmdOrCtrl+2',
  'CmdOrCtrl+3',
  'CmdOrCtrl+4',
  'CmdOrCtrl+5',
  'CmdOrCtrl+6',
  'CmdOrCtrl+7',
  'CmdOrCtrl+8',
  'CmdOrCtrl+9',
  'CmdOrCtrl+=',
  'CmdOrCtrl+-',
  'CmdOrCtrl+Left',
  'CmdOrCtrl+Right',
  'CmdOrCtrl+T',
  'CmdOrCtrl+W',
  'CmdOrCtrl+,',
])

const transport: ApiTransport = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  subscribe: (channel, listener) => {
    const ipcListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(args)
    ipcRenderer.on(channel, ipcListener)
    return () => ipcRenderer.removeListener(channel, ipcListener)
  },
}

contextBridge.exposeInMainWorld(
  'electronAPI',
  buildElectronApi(transport, {
    mode: 'native',
    locals: {
      'keyboard.isReserved': (accelerator: string) => RESERVED_SHORTCUTS.has(accelerator),
      getFilePath: (file: File): string => webUtils.getPathForFile(file),
      // Dynamic passthrough for extension-owned channels.
      'extensionBridge.invoke': (channel: string, payload?: unknown) =>
        ipcRenderer.invoke(channel, payload),
      'extensionBridge.on': (channel: string, handler: (data: unknown) => void) => {
        const listener = (_: Electron.IpcRendererEvent, data: unknown) => handler(data)
        ipcRenderer.on(channel, listener)
        return () => ipcRenderer.removeListener(channel, listener)
      },
    },
  })
)
