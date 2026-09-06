export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
}

function is429(error: unknown): boolean {
  if (error instanceof Error && 'status' in error) {
    return (error as Error & { status: number }).status === 429
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 100

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!is429(err)) throw err
      lastError = err
      if (attempt < maxAttempts) {
        await delay(baseDelayMs * Math.pow(2, attempt - 1))
      }
    }
  }
  throw lastError
}
