import { randomBytes } from 'crypto'

export interface SessionStoreOptions {
  /** Cookie carrying the session token, e.g. 'app-session'. */
  cookieName: string
  /** Path scope for the issued cookie, e.g. '/app'. */
  cookiePath: string
  ttlMs: number
}

/**
 * Bearer-token session store for one browser surface. The /app/ and /mobile/
 * surfaces each get an instance — issue/validate/expiry/sweep exist once,
 * parameterized by cookie name, path, and TTL (mirrors WsTicketStore's shape).
 */
export class SessionStore {
  private sessions = new Map<string, number>()

  constructor(private readonly opts: SessionStoreOptions) {}

  get size(): number {
    return this.sessions.size
  }

  /** Mints a token and returns it with the Set-Cookie header value. */
  issueSession(): { token: string; setCookie: string } {
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, Date.now() + this.opts.ttlMs)
    const maxAge = Math.floor(this.opts.ttlMs / 1000)
    return {
      token,
      setCookie: `${this.opts.cookieName}=${token}; Path=${this.opts.cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
    }
  }

  /** True when the cookie header carries a live token; expired tokens are forgotten. */
  hasValidSession(cookieHeader: string): boolean {
    const token = this.parseToken(cookieHeader)
    if (!token) return false
    const expiresAt = this.sessions.get(token)
    if (expiresAt === undefined) return false
    if (Date.now() > expiresAt) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  /** Purges expired tokens (called from the hourly cleanup timer). */
  sweep(): void {
    const now = Date.now()
    for (const [token, expiresAt] of this.sessions) {
      if (now > expiresAt) this.sessions.delete(token)
    }
  }

  clear(): void {
    this.sessions.clear()
  }

  private parseToken(cookieHeader: string): string | null {
    const match = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${this.opts.cookieName}=`))
    return match ? match.slice(`${this.opts.cookieName}=`.length) : null
  }
}
