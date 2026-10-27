import type { Autonomy } from '../gates/autonomy.js'

export interface ModeFacts {
  readonly readOnly: boolean
  readonly docsOnly: boolean
  /** The role writes to declared paths only (an output file or an outputs directory). */
  readonly restrictedWrites: boolean
  readonly autonomy: Autonomy
  /** The `letAutoModeDecide` setting. */
  readonly letModeDecide: boolean
}

export type PermissionMode = 'auto' | 'default'

// `default` raises an ACP ask for every write and state-changing command, so Foundry's policy
// decides each one. `auto` lets Claude's classifier decide, which only a role free to write
// anywhere in its checkout may have, and never at `escorted`, whose meaning is "ask me".
export function modeFor(facts: ModeFacts): PermissionMode {
  const freeWriter = !facts.readOnly && !facts.docsOnly && !facts.restrictedWrites
  return freeWriter && facts.letModeDecide && facts.autonomy !== 'escorted' ? 'auto' : 'default'
}
