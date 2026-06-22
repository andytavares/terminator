// Sliding-window brute-force protection for the remote-control password check.
// The server binds to 0.0.0.0 (LAN + ngrok), so a single shared bcrypt password
// is the trust boundary — it must not be brute-forceable. After `maxAttempts`
// failed bcrypt comparisons from one client within `windowMs`, that client is
// locked out until the oldest failure ages out of the window. Locked requests
// short-circuit before bcrypt (so they don't extend their own lockout) and a
// successful auth clears the client's history.
//
// In-memory and per-process by design: the remote server is a single embedded
// process, and an attacker restarting it would need filesystem access already.

interface AuthRateLimiterOptions {
  maxAttempts?: number
  windowMs?: number
  now?: () => number
}

export class AuthRateLimiter {
  private readonly maxAttempts: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly failures = new Map<string, number[]>()

  constructor(opts: AuthRateLimiterOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 10
    this.windowMs = opts.windowMs ?? 15 * 60 * 1000
    this.now = opts.now ?? Date.now
  }

  private prune(key: string): number[] {
    const cutoff = this.now() - this.windowMs
    const recent = (this.failures.get(key) ?? []).filter((t) => t > cutoff)
    if (recent.length > 0) this.failures.set(key, recent)
    else this.failures.delete(key)
    return recent
  }

  isLockedOut(key: string): boolean {
    return this.prune(key).length >= this.maxAttempts
  }

  recordFailure(key: string): void {
    const recent = this.prune(key)
    recent.push(this.now())
    this.failures.set(key, recent)
  }

  recordSuccess(key: string): void {
    this.failures.delete(key)
  }
}
