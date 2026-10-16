import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { buildElectronApi, type ApiTransport } from '../shared/electron-api/build-api.js'
import { FRAME_PORT_CHANNEL, FRAME_PORT_MESSAGE } from '../shared/frame-wire.js'

// The electronAPI surface is declared once in src/shared/electron-api/manifest.ts;
// this file only supplies the native transport (ipcRenderer) and the handful of
// implementations that must run in the preload context.
//
// Bundling note: the shared manifest/builder are inlined into this entry by the
// preload build, so the preload stays one file Electron's sandboxed require can load.

// A frame's port reaches the isolated world; the page's own postMessage forwards
// it to the main world, which hands it to the iframe (Electron message-ports guide).
ipcRenderer.on(FRAME_PORT_CHANNEL, (event, { frameToken }: { frameToken: string }) => {
  window.postMessage({ type: FRAME_PORT_MESSAGE, frameToken }, '*', event.ports)
})

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
      getFilePath: (file: File): string => webUtils.getPathForFile(file),
      // Dynamic passthrough for extension-owned channels.
      'extensionBridge.invoke': (channel: string, payload?: unknown) =>
        ipcRenderer.invoke(channel, payload),
      'extensionBridge.on': (channel: string, handler: (data: unknown) => void) =>
        transport.subscribe(channel, ([data]) => handler(data)),
    },
  })
)
