// Which session is running which lane.
//
// This lives in console-owned storage, keyed by work item and lane position,
// precisely so that binding a session requires no write to producer-owned
// state (FR-075). The producer's contract file stays byte-for-byte unchanged
// for the whole life of a session — the sharpest test of the boundary, and the
// one in quickstart.md § P6.

export interface LaneBinding {
  readonly workItemId: string
  readonly laneOrd: number
  readonly sessionId: string
  readonly boundAt: number
}

export interface BindingStore {
  get(): unknown
  set(value: unknown): void
}

export interface LaneBindings {
  bind(workItemId: string, laneOrd: number, sessionId: string, at: number): LaneBinding
  unbind(workItemId: string, laneOrd: number): void
  forLane(workItemId: string, laneOrd: number): LaneBinding | null
  forWorkItem(workItemId: string): LaneBinding[]
  forSession(sessionId: string): LaneBinding | null
}

const key = (workItemId: string, laneOrd: number): string => `${workItemId}#${laneOrd}`

function isBinding(value: unknown): value is LaneBinding {
  if (typeof value !== 'object' || value === null) return false
  const binding = value as Record<string, unknown>
  return (
    typeof binding.workItemId === 'string' &&
    typeof binding.laneOrd === 'number' &&
    typeof binding.sessionId === 'string'
  )
}

export function createLaneBindings(store: BindingStore): LaneBindings {
  const bindings = new Map<string, LaneBinding>()
  const raw = store.get()
  if (typeof raw === 'object' && raw !== null) {
    for (const [k, value] of Object.entries(raw as Record<string, unknown>)) {
      // A corrupt entry costs that one binding, not the whole map.
      if (isBinding(value)) bindings.set(k, value)
    }
  }

  const persist = (): void => store.set(Object.fromEntries(bindings))

  return {
    bind(workItemId: string, laneOrd: number, sessionId: string, at: number): LaneBinding {
      // Single-valued per lane. Re-binding replaces rather than accumulating:
      // a lane run twice is a new session, not two live ones (spec Edge Cases).
      const binding: LaneBinding = { workItemId, laneOrd, sessionId, boundAt: at }
      bindings.set(key(workItemId, laneOrd), binding)
      persist()
      return binding
    },

    unbind(workItemId: string, laneOrd: number): void {
      if (bindings.delete(key(workItemId, laneOrd))) persist()
    },

    forLane(workItemId: string, laneOrd: number): LaneBinding | null {
      return bindings.get(key(workItemId, laneOrd)) ?? null
    },

    forWorkItem(workItemId: string): LaneBinding[] {
      return [...bindings.values()]
        .filter((binding) => binding.workItemId === workItemId)
        .sort((a, b) => a.laneOrd - b.laneOrd)
    },

    forSession(sessionId: string): LaneBinding | null {
      return [...bindings.values()].find((binding) => binding.sessionId === sessionId) ?? null
    },
  }
}
