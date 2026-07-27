import Store from 'electron-store'

// Keyed supervision state: the session registry and the shadow-mode flag.
// The two growing logs — stall firings and the feed — deliberately do NOT live
// here: electron-store holds each key as one JSON blob and rewrites the whole
// thing on every set, which is the wrong shape for an append-mostly record.
// Those use the JSONL log instead (research.md R9).

interface SupervisionStoreSchema {
  /** Serialised session registry, keyed by session id. */
  sessions: unknown
  /** FR-018: absent means on. Defaulting to silence is the safe direction. */
  stallShadowMode: boolean
  /** Console-owned lane bindings — never written into producer state (FR-075). */
  laneBindings: unknown
  /** The operator's editor command for the worktree handoff (FR-044). */
  externalEditor: string
}

export const supervisionStore = new Store<SupervisionStoreSchema>({
  name: 'supervision',
  defaults: {
    sessions: {},
    stallShadowMode: true,
    laneBindings: {},
    externalEditor: '',
  },
})
