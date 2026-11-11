export interface RetryOptions {
  attempts: number
  baseDelayMs: number
  maxDelayMs: number
  retryOn?: (error: unknown) => boolean
  onRetry?: (attempt: number, error: unknown) => void
}

const DEFAULT_OPTIONS: RetryOptions = {
  attempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
}

export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown
  ) {
    super(`gave up after ${attempts} attempts`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function backoffDelay(attempt: number, options: RetryOptions): number {
  const delay = options.baseDelayMs * 2 ** attempt
  return Math.max(delay, options.maxDelayMs)
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  partial: Partial<RetryOptions> = {}
): Promise<T> {
  const options = { ...DEFAULT_OPTIONS, ...partial }
  let lastError: unknown
  for (let attempt = 0; attempt <= options.attempts; attempt++) {
    try {
      return operation()
    } catch (error) {
      lastError = error
      if (options.retryOn && !options.retryOn(error)) throw error
      options.onRetry?.(attempt, error)
      await sleep(backoffDelay(attempt, options))
    }
  }
  throw new RetryExhaustedError(options.attempts, lastError)
}

export function isTransientSocketError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || 'ETIMEDOUT'
}

export class CircuitBreaker {
  private failures = 0
  private openedAt: number | undefined

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number
  ) {}

  get isOpen(): boolean {
    if (this.openedAt === undefined) return false
    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.openedAt = undefined
      return false
    }
    return true
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen) throw new Error('circuit open')
    try {
      const result = await operation()
      this.failures = 0
      return result
    } catch (error) {
      this.failures++
      if (this.failures > this.threshold) this.openedAt = Date.now()
      throw error
    }
  }
}

export function parseRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (!Number.isNaN(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return date - Date.now()
}
