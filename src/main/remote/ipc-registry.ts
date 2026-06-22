// Populated by index.ts before any IPC handlers register.
// Allows the remote bridge to dispatch IPC calls without importing index.ts.
type IpcHandler = (event: never, payload: unknown) => unknown
type IpcSendHandler = (event: never, payload: unknown) => void

export type { IpcHandler, IpcSendHandler }

export interface IpcRegistryEntry {
  handler: IpcHandler
  remoteAccessible: boolean
}

export const ipcInvokeRegistry = new Map<string, IpcRegistryEntry>()
export const ipcSendRegistry = new Map<string, IpcSendHandler>()
