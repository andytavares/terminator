import * as path from 'node:path'
import { CHECK_NAMES } from '../verify/check-names.js'
import { SCHEMA_VERSION, WorkOrderSchema, type OrderSource, type WorkOrder } from './schema.js'

export interface DraftOrderInput {
  readonly id: string
  readonly title: string
  readonly source: {
    kind: OrderSource['kind']
    tracker: OrderSource['tracker']
    key: string | null
    url: string | null
  }
  readonly repoPaths: readonly string[]
  readonly now: string
  readonly baseBranch?: string
}

/**
 * A valid, empty draft.
 *
 * The Forge always has a real document to show, from the first turn — never a
 * progress bar over nothing (FR-003). One lane per repository from the start,
 * because a two-repository order has to be expressible before anyone plans it.
 */
export function draftOrder(input: DraftOrderInput): WorkOrder {
  const base = input.baseBranch ?? 'main'
  const repos = input.repoPaths.map((repoPath, index) => ({
    name: path.basename(repoPath),
    path: repoPath,
    lane: index + 1,
    baseBranch: base,
    headBranch: '',
  }))

  return WorkOrderSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    status: 'draft',
    source: input.source,
    writeBack: [],
    stateMapping: { started: null, in_review: null, done: null },
    recipe: null,
    recipeOverriddenBy: null,
    intent: { problem: '', outcome: '', nonGoals: [] },
    context: {
      repos,
      toolchain: Object.fromEntries(CHECK_NAMES.map((name) => [name, null])),
      entryPoints: [],
      priorArt: [],
      conventions: [],
      houseDocs: [],
    },
    acceptance: [],
    risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
    plan: {
      units: [],
      lanes: repos.map((repo) => ({
        ord: repo.lane,
        repo: repo.name,
        branch: '',
        role: null,
        blocks: [],
        blockedBy: [],
      })),
      sharedFiles: [],
    },
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: input.now,
    agreedAt: null,
  })
}
