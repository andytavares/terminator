import type { PtyManager } from './pty-manager.js'
import { OutputBatcher } from './output-batcher.js'
import { FlowControl } from './flow-control.js'

/** Sends one message to the renderer; false when there was no window to receive it. */
export type RendererSend = (channel: string, payload: object) => boolean

/**
 * Carries a session's output and exit to the renderer: one message per frame,
 * paused at the source while the renderer has not yet written what it was sent.
 * Pending output leaves before the exit does, so the renderer never sees an
 * exit with output still to come.
 */
export class OutputRelay {
  private readonly flows = new Map<string, FlowControl>()

  constructor(
    private readonly ptyManager: PtyManager,
    private readonly send: RendererSend
  ) {}

  start(sessionId: string): void {
    const flow = new FlowControl({
      pause: () => this.ptyManager.pause(sessionId),
      resume: () => this.ptyManager.resume(sessionId),
    })
    this.flows.set(sessionId, flow)
    const batcher = new OutputBatcher((data) => {
      if (this.send('terminal:output', { sessionId, data })) flow.sent(data.length)
    })
    this.ptyManager.onData(sessionId, (data) => batcher.push(data))
    this.ptyManager.onExit(sessionId, (exitCode) => {
      batcher.flush()
      this.flows.delete(sessionId)
      this.send('terminal:process-exit', { sessionId, exitCode })
    })
  }

  /** The renderer has written `count` characters of this session's output. */
  acknowledge(sessionId: string, count: number): void {
    this.flows.get(sessionId)?.acknowledged(count)
  }

  /** A renderer has just attached: whatever the previous one owed is forgotten. */
  reset(sessionId: string): void {
    this.flows.get(sessionId)?.reset()
  }
}
