// The wire between an extension frame and main (ADR 114). Main hands each frame one end of a
// MessageChannelMain; the frame's electronAPI speaks these messages over it, in the shapes the
// remote bridge already uses (src/renderer-remote/electron-api-shim.ts).

/** What a frame sends main. */
export type FrameRequest =
  | { type: 'invoke'; id: string; channel: string; payload?: unknown }
  | { type: 'send'; channel: string; payload?: unknown }
  | { type: 'subscribe'; channel: string }
  | { type: 'request-exit' }
  | { type: 'quick-actions-open' }
  | { type: 'settings-open' }

/** What main sends a frame. */
export type FrameReply =
  | { type: 'result'; id: string; result: unknown }
  | { type: 'error'; id: string; error: string }
  | { type: 'event'; channel: string; args: unknown[] }
  | { type: 'theme'; theme: 'dark' | 'light' }

/** Main → renderer: the port for the frame that asked with `frameToken`. */
export const FRAME_PORT_CHANNEL = 'extension:frame-port'

/** Renderer → main: asks for a port for one frame. Payload is `FramePortRequest`. */
export const OPEN_FRAME_PORT_CHANNEL = 'extension:open-frame-port'

export interface FramePortRequest {
  extensionId: string
  viewParam: string
  /** Chosen by the renderer per frame load, so the reply finds its frame. */
  frameToken: string
}

/** Renderer → frame: the window message that carries the port. Its type is this string. */
export const FRAME_PORT_MESSAGE = 'terminator:frame-port'
