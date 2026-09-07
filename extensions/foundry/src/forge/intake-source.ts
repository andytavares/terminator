import * as fs from 'node:fs'
import * as path from 'node:path'
import { draftOrder } from '../order/schema.js'
import type { OrderSource, WorkOrder } from '../order/schema.js'
import { probeToolchain, unavailableChecks } from '../verify/toolchain-probe.js'
import type { CheckName } from '../verify/toolchain-probe.js'

// Seeding an order.
//
// The ordering here is the whole point of FR-002: the repository is read
// before the operator could possibly be asked anything. By the time a draft
// exists, the toolchain has been probed and whatever the project says about
// itself has been picked up — so any question that survives is one the code
// genuinely could not answer, and a question the code *could* have answered is
// a defect in intake rather than a question.

/** House documents, in the order they are looked for. Absence is normal. */
const HOUSE_DOCS = [
  'CLAUDE.md',
  'AGENTS.md',
  '.specify/memory/constitution.md',
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
  'docs/ARCHITECTURE.md',
]

export interface IssueLike {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly url: string
  /** The tracker's own suggested branch name, when it has one. */
  readonly branchName: string | null
}

export interface SeedDeps {
  readonly now: () => string
  readonly newId: () => string
  readonly readIssue?: (tracker: 'linear' | 'jira', key: string) => Promise<IssueLike | null>
  readonly existingOrderFor?: (
    tracker: 'linear' | 'jira',
    key: string
  ) => { id: string; title: string } | null
  /**
   * What was already decided about these files (FR-077).
   *
   * Read before the operator is asked anything, like everything else in
   * Scout's pack: a question the record could have answered is a defect in
   * intake rather than a question. Absent, and an empty answer, both mean
   * "nothing on file" — which is the common case and costs nothing.
   */
  readonly priorArtFor?: (paths: readonly string[]) => Promise<string[]>
}

export type SeedInput =
  | { kind: 'typed'; text: string; repoPaths: readonly string[] }
  | { kind: 'tracker'; tracker: 'linear' | 'jira'; key: string; repoPaths: readonly string[] }

export type SeedResult =
  | { order: WorkOrder; unavailableChecks: CheckName[] }
  | { existing: { id: string; title: string } }
  | { error: string }

/**
 * File paths named in a sentence.
 *
 * Deliberately crude — something with a slash and an extension. An idea that
 * names no file gets no prior art, which is better than a fuzzy match that
 * dredges up decisions about something else and presents them as relevant.
 */
export function pathsNamedIn(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]{1,6}\b/g) ?? []
  return [...new Set(matches.filter((token) => token.includes('/')))]
}

/** Whatever the repository says about itself. Absence is a normal answer. */
export function houseDocsIn(repoPath: string): string[] {
  return HOUSE_DOCS.filter((rel) => fs.existsSync(path.join(repoPath, rel)))
}

/**
 * `WO-MMDD-xxx`. Dated so a directory listing sorts, and randomised so two
 * orders seeded in the same minute cannot land on the same id.
 */
export function newOrderId(at: Date = new Date(), random: () => number = Math.random): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0')
  const day = String(at.getUTCDate()).padStart(2, '0')
  const suffix = Math.floor(random() * 0x1000)
    .toString(16)
    .padStart(3, '0')
  return `WO-${month}${day}-${suffix}`
}

/** A title from a typed idea: the first sentence, trimmed to something readable. */
function titleFrom(text: string): string {
  const firstSentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? text.trim()
  return firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}…` : firstSentence
}

export async function seedOrder(input: SeedInput, deps: SeedDeps): Promise<SeedResult> {
  if (input.repoPaths.length === 0) {
    return { error: 'An order needs at least one repository to be about.' }
  }

  let title: string
  let problem: string
  let source: OrderSource
  let branchName: string | null = null

  if (input.kind === 'typed') {
    if (input.text.trim() === '') {
      return { error: 'An order needs an idea. Say what is wrong or what should exist.' }
    }
    title = titleFrom(input.text)
    problem = input.text.trim()
    source = { kind: 'typed', tracker: null, key: null, url: null }
  } else {
    const existing = deps.existingOrderFor?.(input.tracker, input.key) ?? null
    if (existing !== null) return { existing }

    const issue = (await deps.readIssue?.(input.tracker, input.key)) ?? null
    if (issue === null) {
      return { error: `Could not read ${input.key} from ${input.tracker}.` }
    }
    title = issue.title
    // A description is often absent and that is fine — the title is still a
    // statement of the problem, and the rest becomes an assumption to strike.
    problem = issue.description.trim() === '' ? issue.title : issue.description.trim()
    source = { kind: 'tracker', tracker: input.tracker, key: issue.key, url: issue.url }
    branchName = issue.branchName
  }

  const order = draftOrder({
    id: deps.newId(),
    title,
    source,
    repoPaths: input.repoPaths,
    now: deps.now(),
  })

  // Scout's pack, before any question could be asked.
  const toolchain = probeToolchain(input.repoPaths[0])
  const houseDocs = input.repoPaths.flatMap((repoPath) => houseDocsIn(repoPath))

  // What was already decided about the files this idea names. A failure to
  // read the record is not a failure to seed an order: the draft is what the
  // operator asked for, and prior art is a courtesy on top of it.
  const named = pathsNamedIn(problem)
  let priorArt: string[] = []
  if (named.length > 0) {
    try {
      priorArt = [...((await deps.priorArtFor?.(named)) ?? [])]
    } catch {
      priorArt = []
    }
  }

  const seeded: WorkOrder = {
    ...order,
    intent: { ...order.intent, problem },
    context: { ...order.context, toolchain, houseDocs, priorArt },
    plan: {
      ...order.plan,
      // The tracker's own branch name where there is one, rather than an
      // invented one nobody will recognise on the remote.
      lanes: order.plan.lanes.map((lane, index) =>
        index === 0 && branchName !== null ? { ...lane, branch: branchName } : lane
      ),
    },
  }

  return { order: seeded, unavailableChecks: unavailableChecks(toolchain) }
}
