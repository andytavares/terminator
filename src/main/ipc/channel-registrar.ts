import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote/remote-accessible-channels.js'
import { ipcInvokeRegistry, ipcSendRegistry, type IpcSendHandler } from '../remote/ipc-registry.js'

// The single registration point for main-process IPC channels. Every channel
// registered here is wired into ipcMain AND recorded in the bridge registry so
// the remote-control extension can dispatch it for browser clients. Whether a
// channel is reachable remotely is decided at registration: explicitly via
// opts.remoteAccessible, otherwise from the core allowlist
// (remote-accessible-channels.ts).

export interface HandleChannelOptions {
  remoteAccessible?: boolean
}

export function handleChannel(
  channel: string,
  handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown,
  opts?: HandleChannelOptions
): void {
  ipcMain.handle(channel, handler)
  const remoteAccessible = opts?.remoteAccessible ?? REMOTE_ACCESSIBLE_CHANNELS.has(channel)
  ipcInvokeRegistry.set(channel, { handler, remoteAccessible })
}

/** `Payload` is what the sender is trusted to send; nothing here checks it. */
export function onChannel<Payload>(
  channel: string,
  listener: (event: IpcMainEvent, payload: Payload) => void
): void {
  ipcMain.on(channel, listener)
  ipcSendRegistry.set(channel, listener as IpcSendHandler)
}

export function removeChannel(channel: string): void {
  ipcMain.removeHandler(channel)
  ipcInvokeRegistry.delete(channel)
}
