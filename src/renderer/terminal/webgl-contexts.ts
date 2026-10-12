// Chromium keeps at most 16 live WebGL contexts per page and silently drops the
// oldest beyond that. Terminals take contexts from this budget, which stays under
// the cap to leave room for the canvases other views create.
export const MAX_WEBGL_CONTEXTS = 12

export class WebglContextBudget {
  private readonly holders = new Set<string>()

  constructor(private readonly limit: number) {}

  acquire(owner: string): boolean {
    if (this.holders.has(owner)) return true
    if (this.holders.size >= this.limit) return false
    this.holders.add(owner)
    return true
  }

  release(owner: string): void {
    this.holders.delete(owner)
  }
}

export const webglContexts = new WebglContextBudget(MAX_WEBGL_CONTEXTS)
