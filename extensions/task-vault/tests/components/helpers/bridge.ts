import { vi } from 'vitest'
import type { IndexedProject, IndexedTask } from '../../../src/vault/types'

type Responder = unknown | ((payload: unknown) => unknown)

/**
 * Installs a fake `window.electronAPI` whose extension bridge answers invokes by
 * channel (a value, or a function of the payload), and lets a test push to subscribers.
 */
export function installBridge(extra: Record<string, unknown> = {}) {
  const responses: Record<string, Responder> = {}
  const handlers = new Map<string, (data: unknown) => void>()
  const invoke = vi.fn(async (channel: string, payload?: unknown) => {
    const answer = responses[channel]
    if (typeof answer === 'function') return (answer as (p: unknown) => unknown)(payload)
    return answer ?? { success: true }
  })
  const on = vi.fn((channel: string, handler: (data: unknown) => void) => {
    handlers.set(channel, handler)
    return () => handlers.delete(channel)
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on }, ...extra },
    writable: true,
    configurable: true,
  })
  const push = (channel: string, data: unknown) => handlers.get(channel)?.(data)
  const calls = (channel: string) =>
    invoke.mock.calls.filter(([ch]) => ch === channel).map((call) => (call as unknown[])[1])
  return { responses, invoke, push, calls }
}

/** A task as the vault channels return it. */
export function task(id: string, text: string, overrides: Partial<IndexedTask> = {}): IndexedTask {
  return {
    id,
    filePath: 'daily/2026-01-05',
    line: 0,
    status: 'open',
    text,
    terminatorLinks: [],
    subtasks: [],
    ...overrides,
  }
}

/** A project as the vault channels return it. */
export function project(name: string, overrides: Partial<IndexedProject> = {}): IndexedProject {
  return {
    id: `p-${name}`,
    filePath: name,
    name,
    status: 'active',
    isStale: false,
    nextActionCount: 1,
    lastModified: '2026-01-01T00:00:00Z',
    terminatorLinks: [],
    ...overrides,
  }
}

/** Waits for an assertion to hold, allowing for a loaded machine. */
export function eventually(assertion: () => void, timeout = 8000) {
  return vi.waitFor(assertion, { timeout })
}
