// Watermark flow control, as the xterm.js guide describes it:
// https://xtermjs.org/docs/guides/flowcontrol/
// Without it a process that prints faster than xterm can parse (`cat` of a large
// file) fills the renderer's queue and memory. Units are string lengths, counted
// the same way on both sides of the IPC.

/** Above this many unacknowledged characters the process is paused. @internal */
export const HIGH_WATERMARK_CHARS = 1024 * 1024

/** A paused process resumes once unacknowledged characters fall below this. @internal */
export const LOW_WATERMARK_CHARS = 256 * 1024

export interface PausableOutput {
  pause(): void
  resume(): void
}

export class FlowControl {
  private unacknowledged = 0
  private paused = false

  constructor(private readonly output: PausableOutput) {}

  sent(count: number): void {
    this.unacknowledged += count
    if (!this.paused && this.unacknowledged > HIGH_WATERMARK_CHARS) {
      this.paused = true
      this.output.pause()
    }
  }

  acknowledged(count: number): void {
    this.unacknowledged = Math.max(0, this.unacknowledged - count)
    if (this.paused && this.unacknowledged < LOW_WATERMARK_CHARS) this.resumeOutput()
  }

  /** Forget what is owed: the renderer that owed it is gone or starting over. */
  forgetOwed(): void {
    this.unacknowledged = 0
    if (this.paused) this.resumeOutput()
  }

  private resumeOutput(): void {
    this.paused = false
    this.output.resume()
  }
}
