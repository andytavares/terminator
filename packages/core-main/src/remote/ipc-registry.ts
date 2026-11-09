import type { z } from 'zod'

// Populated by index.ts before any IPC handlers register.
// Allows the remote bridge to dispatch IPC calls without importing index.ts.
type IpcHandler = (event: never, payload: unknown) => unknown
type IpcSendHandler = (event: never, payload: unknown) => void

export type { IpcSendHandler }

export interface IpcRegistryEntry {
  handler: IpcHandler
  remoteAccessible: boolean
  /** The payload schema of a validated row; the Terminator MCP server lists it as the input schema. */
  schema?: z.ZodType
}

export const ipcInvokeRegistry = new Map<string, IpcRegistryEntry>()
export const ipcSendRegistry = new Map<string, IpcSendHandler>()
