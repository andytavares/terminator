import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote/remote-accessible-channels.js'
import {
  ipcInvokeRegistry,
  ipcSendRegistry,
  type IpcHandler,
  type IpcSendHandler,
} from '../remote/ipc-registry.js'

// The single registration point for main-process IPC channels. Every channel
// registered here is wired into ipcMain AND recorded in the bridge registry so
// the remote-control extension can dispatch it for browser clients. Whether a
// channel is reachable remotely is decided at registration: explicitly via
// opts.remoteAccessible, otherwise from the core allowlist
// (remote-accessible-channels.ts).

export interface HandleChannelOptions {
  remoteAccessible?: boolean
}

// Handler params mirror Electron's own ipcMain.handle/on signatures so existing
// handler bodies move over unchanged.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function handleChannel(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any,
  opts?: HandleChannelOptions
): void {
  ipcMain.handle(channel, handler)
  const remoteAccessible = opts?.remoteAccessible ?? REMOTE_ACCESSIBLE_CHANNELS.has(channel)
  ipcInvokeRegistry.set(channel, { handler: handler as IpcHandler, remoteAccessible })
}

export function onChannel(
  channel: string,
  listener: (event: IpcMainEvent, ...args: any[]) => void
): void {
  ipcMain.on(channel, listener)
  ipcSendRegistry.set(channel, listener as IpcSendHandler)
}

export function removeChannel(channel: string): void {
  ipcMain.removeHandler(channel)
  ipcInvokeRegistry.delete(channel)
}
