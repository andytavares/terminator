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

type DraftRepo = WorkOrder['context']['repos'][number]

/** One repository per path, each in its own lane, in the order given. */
function reposOf(input: DraftOrderInput): DraftRepo[] {
  const base = input.baseBranch ?? 'main'
  return input.repoPaths.map((repoPath, index) => ({
    name: path.basename(repoPath),
    path: repoPath,
    lane: index + 1,
    baseBranch: base,
    headBranch: '',
  }))
}

/** What is known about the repositories before Scout reads them: where they are, nothing else. */
function emptyContext(repos: readonly DraftRepo[]) {
  return {
    repos,
    toolchain: Object.fromEntries(CHECK_NAMES.map((name) => [name, null])),
    entryPoints: [],
    priorArt: [],
    conventions: [],
    houseDocs: [],
  }
}

/** The repository's lane, unplanned: no branch, no role, nothing blocking it. */
function laneFor(repo: DraftRepo) {
  return { ord: repo.lane, repo: repo.name, branch: '', role: null, blocks: [], blockedBy: [] }
}

// A valid, empty draft, so the Forge shows a real document from the first turn
// (FR-003); one lane per repository, so two repositories are expressible at once.
export function draftOrder(input: DraftOrderInput): WorkOrder {
  const repos = reposOf(input)
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
    context: emptyContext(repos),
    acceptance: [],
    risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
    plan: { units: [], lanes: repos.map(laneFor), sharedFiles: [] },
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: input.now,
    document: null,
    agreedAt: null,
  })
}
