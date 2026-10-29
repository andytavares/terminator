/** Time on a surface stops counting this long after the last keydown or pointerdown. @internal */
export const IDLE_LIMIT_MS = 5 * 60 * 1000

export interface ActiveSpan {
  id: string
  activeMs: number
}

/** Turns what is on screen, window focus and input into spans to record. Every call takes its
 * time, so the caller owns the clock. */
export class ActiveTimeTracker {
  private ids: string[] = []
  private focused = false
  private lastInputAt = -Infinity
  private since: number | null = null
  private readonly accrued = new Map<string, number>()

  /** Moves the time since the last settle into `accrued`, up to the idle limit. */
  private settle(now: number): void {
    if (this.since === null) return
    const ms = Math.max(0, Math.min(now, this.lastInputAt + IDLE_LIMIT_MS) - this.since)
    for (const id of this.ids) this.accrued.set(id, (this.accrued.get(id) ?? 0) + ms)
    this.since = now
  }

  private release(shouldRelease: (id: string) => boolean): ActiveSpan[] {
    const spans: ActiveSpan[] = []
    for (const [id, ms] of this.accrued) {
      if (!shouldRelease(id)) continue
      this.accrued.delete(id)
      if (ms > 0) spans.push({ id, activeMs: Math.round(ms) })
    }
    return spans
  }

  private resume(now: number): void {
    this.since = this.focused && this.ids.length > 0 ? now : null
  }

  input(now: number): void {
    this.settle(now)
    this.lastInputAt = now
  }

  setIds(next: string[], now: number): ActiveSpan[] {
    this.settle(now)
    const spans = this.release((id) => !next.includes(id))
    this.ids = next
    this.resume(now)
    return spans
  }

  setFocused(next: boolean, now: number): ActiveSpan[] {
    this.settle(now)
    this.focused = next
    this.resume(now)
    return next ? [] : this.release(() => true)
  }

  flushAll(now: number): ActiveSpan[] {
    this.settle(now)
    return this.release(() => true)
  }
}
