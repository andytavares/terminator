import { createHook } from 'node:async_hooks'

// Resources that never end by themselves: an interval, a listening server, an open socket, a
// directory watch, a running child. A pending setTimeout is not one, it ends by itself and
// whether it has by the end of a test depends on how long the test took.
const LONG_LIVED = new Set(['TCPSERVERWRAP', 'TCPWRAP', 'FSEVENTWRAP', 'PROCESSWRAP', 'Timeout'])

interface Tracked {
  type: string
  stack: string
  resource: { hasRef?: () => boolean }
}

function isRepeatingTimer(type: string, resource: object): boolean {
  return type !== 'Timeout' || (resource as { _repeat?: number | null })._repeat != null
}

/** The first line of the stack that is a spec's or the code's own, not Node's or this file's. */
function creationLine(stack: string): string {
  const lines = stack.split('\n').slice(1)
  const own = lines.filter(
    (line) => !line.includes('node:') && !line.includes('support/leak-guard.ts')
  )
  return (own.find((line) => !line.includes('node_modules')) ?? own[0] ?? lines[0]).trim()
}

export interface LeakGuard {
  /** Marks the start of a test: only resources created from now on count. */
  begin(): void
  /** Throws, naming the type and where it was created, if a resource made since `begin` is alive. */
  check(): Promise<void>
}

type Alive = Map<number, Tracked>

/** Records every long-lived resource until it is destroyed. Returns a reader of the newest id. */
function trackResources(alive: Alive): () => number {
  let newestId = 0
  createHook({
    init(...[asyncId, type, , resource]) {
      newestId = asyncId
      if (!LONG_LIVED.has(type) || !isRepeatingTimer(type, resource)) return
      const stack = new Error().stack ?? ''
      alive.set(asyncId, { type, stack, resource: resource as Tracked['resource'] })
    },
    destroy(asyncId) {
      alive.delete(asyncId)
    },
  }).enable()
  return () => newestId
}

// A closed handle is destroyed on the event loop turn after its close callback.
async function letClosedHandlesGo(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setImmediate(resolve))
}

function leakMessage({ type, stack }: Tracked): string {
  return (
    `A test left a ${type} running, created at ${creationLine(stack)}. ` +
    'Clear the interval, close the server or socket, stop the watcher or the child.'
  )
}

export function createLeakGuard(): LeakGuard {
  const alive: Alive = new Map()
  const newestId = trackResources(alive)
  let startedAfterId = 0
  return {
    begin() {
      startedAfterId = newestId()
    },
    async check() {
      await letClosedHandlesGo()
      for (const [asyncId, tracked] of alive) {
        if (asyncId <= startedAfterId || tracked.resource.hasRef?.() === false) continue
        throw new Error(leakMessage(tracked))
      }
    },
  }
}
