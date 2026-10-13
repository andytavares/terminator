/**
 * One animation frame: output is sent at most this long after it arrives.
 * @internal
 */
export const OUTPUT_FLUSH_INTERVAL_MS = 16

/**
 * A batch this large is sent at once instead of waiting for the frame.
 * @internal
 */
export const OUTPUT_FLUSH_MAX_CHARS = 128 * 1024

/**
 * Joins the chunks a PTY produces into one message per frame. A busy process
 * writes thousands of small chunks a second, and each IPC message costs a
 * structured clone, a renderer task and an xterm write.
 */
export class OutputBatcher {
  private chunks: string[] = []
  private size = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly send: (data: string) => void) {}

  push(data: string): void {
    this.chunks.push(data)
    this.size += data.length
    if (this.size >= OUTPUT_FLUSH_MAX_CHARS) {
      this.flush()
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), OUTPUT_FLUSH_INTERVAL_MS)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.chunks.length === 0) return
    const data = this.chunks.join('')
    this.chunks = []
    this.size = 0
    this.send(data)
  }
}
