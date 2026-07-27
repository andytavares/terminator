import { createServer } from 'net'

// Port allocation for concurrently provisioned working copies. Two guarantees:
// spans never overlap each other (SC-008), and a span is probed for actual
// availability before it is handed out — our own bookkeeping cannot know about
// a process outside the app already holding a port.

export interface PortSpan {
  readonly portBase: number
  readonly portSpan: number
}

export interface AllocateOptions {
  base: number
  span: number
  /** Spans held by working copies that are already live. */
  taken: readonly PortSpan[]
  /** Probe. Injected so allocation logic is testable without binding sockets. */
  isFree: (port: number) => boolean
}

const MAX_PORT = 65_535

function overlaps(a: PortSpan, b: PortSpan): boolean {
  // Half-open intervals: [base, base + span).
  return a.portBase < b.portBase + b.portSpan && b.portBase < a.portBase + a.portSpan
}

/**
 * Returns the first span at or after `base` that collides with nothing and
 * probes free, or null when the port range is exhausted.
 */
export function allocatePortSpan(options: AllocateOptions): PortSpan | null {
  const { base, span, taken, isFree } = options

  for (let portBase = base; portBase + span - 1 <= MAX_PORT; portBase += span) {
    const candidate: PortSpan = { portBase, portSpan: span }
    if (taken.some((held) => overlaps(candidate, held))) continue

    // Every port in the span must be free, not just the first: a dev server and
    // its debugger sit at different offsets within the same span.
    let allFree = true
    for (let port = portBase; port < portBase + span; port++) {
      if (!isFree(port)) {
        allFree = false
        break
      }
    }
    if (allFree) return candidate
  }

  return null
}

/**
 * Real availability probe: attempt a bind and release it immediately. Used in
 * production; tests inject a predicate instead.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}
