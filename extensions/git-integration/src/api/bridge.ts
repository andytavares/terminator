// The extension bridge returns `unknown`; the handlers registered in src/ipc own each
// channel's result shape, so wrappers state it here, once, per channel.
interface BridgeError {
  error: string
  resetAt?: number
}

export type BridgeResult<T> = T | BridgeError
