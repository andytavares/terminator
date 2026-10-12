// The extension bridge returns `unknown`; the handlers registered in src/ipc own each
// channel's result shape, so wrappers state it here, once, per channel.
export interface BridgeError {
  error: string
  resetAt?: number
}

export type BridgeResult<T> = T | BridgeError

export function invokeBridge<T>(channel: string, payload?: unknown): Promise<T> {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<T>
}
