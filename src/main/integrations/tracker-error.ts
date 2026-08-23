import type { TrackerErrorKind } from '../../shared/types/index.js'

// The closed taxonomy every tracker failure is funnelled through.
//
// It exists so a surface can tell "not connected" from "connection failed"
// from "no results" — three states that look identical once an error has been
// flattened into an empty array, and which need three different things from
// the operator.
//
// A raw HTTP status or SDK error never escapes a provider: it is translated
// here, once, or it lands on 'failed' carrying the tracker's own words.

interface TrackerErrorOptions {
  /** Only meaningful for 'rate-limited': how long the tracker said to wait. */
  retryAfterMs?: number
  cause?: unknown
}

export class TrackerError extends Error {
  readonly kind: TrackerErrorKind
  readonly retryAfterMs?: number

  readonly cause?: unknown

  constructor(kind: TrackerErrorKind, message: string, options: TrackerErrorOptions = {}) {
    // Assigned rather than passed to super(): the main process compiles against
    // a lib without ErrorOptions in its Error constructor.
    super(message)
    if (options.cause !== undefined) this.cause = options.cause
    this.name = 'TrackerError'
    this.kind = kind
    // Carried only where it means something, so a caller reading it on any
    // other kind gets undefined rather than a number it would act on.
    if (kind === 'rate-limited' && options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs
    }
  }
}

const STATUS_KINDS: ReadonlyMap<number, TrackerErrorKind> = new Map([
  [401, 'auth-failed'],
  [403, 'auth-failed'],
  [404, 'not-found'],
  [429, 'rate-limited'],
])

/**
 * Translate an HTTP response into the taxonomy. The tracker's own message is
 * kept verbatim — a Jira JQL syntax error is far more useful to the operator
 * than "request failed".
 */
export function fromHttpStatus(
  status: number,
  message: string,
  options: { retryAfterSeconds?: number } = {}
): TrackerError {
  const mapped = STATUS_KINDS.get(status)
  const kind: TrackerErrorKind = mapped ?? (status >= 500 ? 'unavailable' : 'failed')
  return new TrackerError(kind, message, {
    retryAfterMs:
      options.retryAfterSeconds === undefined ? undefined : options.retryAfterSeconds * 1000,
  })
}

// Node surfaces a dead network as a TypeError from fetch with one of these on
// the cause. Without this they would all read as 'failed', and the operator
// would be told their credential was wrong when their wifi was off.
const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
])

function networkCodeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const code = (value as { code?: unknown }).code
  if (typeof code === 'string') return code
  return networkCodeOf((value as { cause?: unknown }).cause)
}

/** Reduce anything thrown to a kind. Never throws, never returns undefined. */
export function toErrorKind(error: unknown): TrackerErrorKind {
  if (error instanceof TrackerError) return error.kind
  const code = networkCodeOf(error)
  if (code !== undefined && NETWORK_CODES.has(code)) return 'unavailable'
  return 'failed'
}

/** The message a surface shows, falling back to something honest. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}
