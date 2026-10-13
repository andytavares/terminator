import { OutputBatcher } from '../terminal/output-batcher.js'
import type { PtyManager } from '../terminal/pty-manager.js'

type PtySource = Pick<PtyManager, 'onData' | 'onExit'>

/** A session's output as an extension receives it (SDK 4.0.0): at most one batch per frame, so a
 * busy process costs one message per frame across the extension host's port, and every batch
 * delivered before the session's exit. */
export class BatchedPtyStream {
  private readonly pending = new Map<string, Set<OutputBatcher>>()

  constructor(private readonly source: PtySource) {}

  onData(sessionId: string, listener: (data: string) => void): () => void {
    let active = true
    const batcher = new OutputBatcher((data) => {
      if (active) listener(data)
    })
    const dispose = this.source.onData(sessionId, (data) => batcher.push(data))
    if (!dispose) return () => {}
    const batchers = this.batchersOf(sessionId)
    batchers.add(batcher)
    return () => {
      active = false
      dispose()
      batchers.delete(batcher)
    }
  }

  onExit(sessionId: string, listener: (exitCode: number | null) => void): () => void {
    const dispose = this.source.onExit(sessionId, (exitCode) => {
      this.flush(sessionId)
      listener(exitCode)
    })
    return dispose ?? (() => {})
  }

  private batchersOf(sessionId: string): Set<OutputBatcher> {
    const existing = this.pending.get(sessionId)
    if (existing) return existing
    const batchers = new Set<OutputBatcher>()
    // A session that already exited has no exit to wait for; its batchers flush on their timers.
    const watching = this.source.onExit(sessionId, () => {
      this.flush(sessionId)
      this.pending.delete(sessionId)
    })
    if (watching) this.pending.set(sessionId, batchers)
    return batchers
  }

  private flush(sessionId: string): void {
    for (const batcher of this.pending.get(sessionId) ?? []) batcher.flush()
  }
}
