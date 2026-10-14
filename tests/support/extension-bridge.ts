import { vi } from 'vitest'

type Responder = unknown | ((payload: unknown) => unknown)

/** Installs a fake `window.electronAPI` whose extension bridge answers invokes by channel (a value,
 * or a function of the payload; `fallback` otherwise), and lets a test push to its subscribers. */
export function installExtensionBridge(fallback: unknown, extra: Record<string, unknown> = {}) {
  const responses: Record<string, Responder> = {}
  const subscribers = new Map<string, (data: unknown) => void>()
  const invoke = vi.fn(async (channel: string, payload?: unknown) => {
    const answer = responses[channel]
    if (typeof answer === 'function') return (answer as (p: unknown) => unknown)(payload)
    return answer ?? fallback
  })
  const on = vi.fn((channel: string, handler: (data: unknown) => void) => {
    subscribers.set(channel, handler)
    return () => subscribers.delete(channel)
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on }, ...extra },
    writable: true,
    configurable: true,
  })
  const pushToSubscriber = (channel: string, data: unknown) => subscribers.get(channel)?.(data)
  const payloadsSentTo = (channel: string) =>
    invoke.mock.calls.filter(([ch]) => ch === channel).map((call) => (call as unknown[])[1])
  return { responses, invoke, push: pushToSubscriber, calls: payloadsSentTo }
}

/** Waits for an assertion to hold, allowing for a loaded machine. */
export function eventually(assertion: () => void, timeout = 8000) {
  return vi.waitFor(assertion, { timeout })
}
