import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import { brief } from '../line/brief.js'
import { compileOrder } from '../order/compile.js'
import { parseProposal, applyProposal, PROPOSAL_FILE, ProposalRejected } from '../order/proposal.js'
import { RISK_TRIGGERS } from '../order/schema.js'
import type { WorkOrder } from '../order/schema.js'
import type { Role, Rule } from '../recipe/parse.js'
import { resolveRole } from '../recipe/resolve.js'
import type { ResolveSources } from '../recipe/resolve.js'

// Converging an order.
//
// Seeding produces a draft with a problem statement and what the repository
// says about itself. Something has to turn that into criteria and a plan, and
// that something is an agent — the architect — running *before* agreement,
// over the draft, in the repository it is about.
//
// It runs read-only. Intake changes no code, so the architect gets no write
// list and the `PreToolUse` hook refuses its edits; the one thing it writes is
// a proposal, through a file, which is validated before any of it reaches the
// order. An agent that could write the order directly could set `status` and
// agree its own work.

/** What the architect is told to produce, and where to put it. */
function outputContract(file: string, order: WorkOrder): string {
  const failures = compileOrder(order).failures
  return [
    '',
    '---',
    '',
    '## What to write, and where',
    '',
    `Write a single JSON object to \`${file}\`. Nothing else you do counts.`,
    '',
    'It may contain only these keys, and every one of them is optional — omit',
    'what you are not changing rather than restating it:',
    '',
    '```json',
    '{',
    '  "intent":   { "problem": "…", "outcome": "…", "nonGoals": ["…"] },',
    '  "acceptance": [',
    '    {',
    '      "id": "AC-1",',
    '      "statement": "a statement that can be false",',
    '      "priority": "P0 | P1 | P2",',
    '      "verify": { "kind": "test", "command": "…", "assert": "exit_code == 0" },',
    '      "unverifiable": null',
    '    }',
    '  ],',
    '  "risk":     { "grade": "P0|P1|P2|P3", "triggers": [], "blastRadius": ["src/"], "criticalPaths": [] },',
    '  "budgets":  { "agents": 2, "wallClockMinutes": 45, "filesTouched": 12, "tokens": null },',
    '  "plan": {',
    '    "units": [',
    '      {',
    '        "id": "U-1",',
    '        "title": "…",',
    '        "role": "builder",',
    '        "lane": 1,',
    '        "dependsOn": [],',
    '        "satisfies": ["AC-1"],',
    '        "touches": ["src/…"],',
    '        "verify": []',
    '      }',
    '    ],',
    '    "lanes": [',
    '      { "ord": 1, "repo": "…", "branch": "", "role": null, "blocks": [], "blockedBy": [] }',
    '    ],',
    '    "sharedFiles": []',
    '  },',
    '  "findings": {',
    '    "entryPoints": ["src/…"],',
    '    "conventions": ["what the surrounding code does, in a sentence"],',
    '    "priorArt": ["commit or file, and what it did"]',
    '  },',
    '  "assumptions":   [{ "id": "A-1", "text": "…", "struck": false, "affects": [] }],',
    '  "openQuestions": [',
    '    { "id": "Q-1", "text": "…", "why": "…", "options": ["…"], "recommended": 0, "answer": null, "rank": 1 }',
    '  ],',
    '  "note": "what you changed, in one line"',
    '}',
    '```',
    '',
    '`verify.kind` is one of `test`, `command`, `judge`, `artifact` or `screenshot`.',
    'A `judge` needs a `rubric` and a non-empty `evidence` list; an `artifact`',
    'needs a `path` and an `assert`; a `screenshot` needs a `target`.',
    '',
    // Shown for the same reason `grade` shows its four values, and absent for
    // the whole of the feature that preceded this one. See RISK_TRIGGERS.
    `\`risk.triggers\` is a closed set: each entry is exactly one of ${RISK_TRIGGERS.map(
      (trigger) => `\`${trigger}\``
    ).join(', ')}.`,
    'It is a label, not a sentence. Say *why* a trigger applies in `criticalPaths`',
    'or in the note — a trigger written as prose is refused, and the whole',
    'proposal with it.',
    '',
    'Anything else in that object is refused outright, including `status` — you',
    'do not agree your own work.',
    '',
    '## What will refuse this order if you get it wrong',
    '',
    failures.length === 0
      ? 'Nothing, as it stands. Keep it that way.'
      : failures.map((failure) => `- **${failure.check}** — ${failure.detail}`).join('\n'),
    '',
    'Ask a question only where the repository genuinely cannot answer it, and',
    'never more than three. Anything you decided for yourself is an assumption',
    'the operator can strike, not a fact.',
    '',
    '## How big the plan should be',
    '',
    'Write the smallest plan that covers the ask. A unit is not a file and not',
    'a step — it is work that cannot share a checkout with its neighbours, or',
    'that has to happen before them. Units in one lane run in one worktree, so',
    'splitting them buys nothing and costs a session each: measured on a live',
    'run, seven units in one lane spent seven cold starts on work that was',
    'serial in a single checkout.',
    '',
    'Split a unit when it belongs to a different repository, or when a later',
    'unit genuinely cannot begin until an earlier one has landed. Not because',
    'it touches different files, and not to make the plan look thorough.',
  ].join('\n')
}

export interface ConvergeInput {
  readonly order: WorkOrder
  readonly root: string
  readonly sources: ResolveSources
  readonly rules: readonly Rule[]
  /** What the operator just typed, when they typed something. */
  readonly message?: string
}

export interface ConvergeBrief {
  readonly prompt: string
  /** The file the agent writes, absolute. Read back and validated. */
  readonly proposalPath: string
  readonly role: Role
  /** Where the agent runs. Intake reads the repository; it changes nothing. */
  readonly cwd: string
}

export class NoArchitectError extends Error {
  readonly code = 'NO_ARCHITECT'
  constructor(reason: string) {
    super(`Intake cannot run without an architect role: ${reason}`)
    this.name = 'NoArchitectError'
  }
}

/**
 * Everything needed to run one turn of intake.
 *
 * Built rather than run, so the caller owns the session and this stays a pure
 * function over the order — which is what lets the whole intake path be
 * exercised without an Electron host.
 */
export function convergeBrief(input: ConvergeInput): ConvergeBrief {
  const resolved = resolveRole('architect', input.sources)
  if (!resolved.ok) throw new NoArchitectError(resolved.reason)

  const proposalPath = path.join(orderDir(input.root, input.order.id), PROPOSAL_FILE)
  const body = brief({
    order: input.order,
    role: resolved.resolved.value,
    units: [],
    rules: input.rules,
  })

  const typed =
    input.message === undefined || input.message.trim() === ''
      ? []
      : ['', '---', '', '## What the operator just said', '', input.message.trim()]

  return {
    prompt: [body, ...typed, outputContract(proposalPath, input.order)].join('\n'),
    proposalPath,
    role: resolved.resolved.value,
    // The repository itself, not a worktree: intake reads and changes nothing,
    // and cutting a checkout for it would be creating a branch for a plan that
    // may never be agreed.
    cwd: input.order.context.repos[0]?.path ?? process.cwd(),
  }
}

export type ConvergeResult =
  | { ok: true; order: WorkOrder; note: string }
  | { ok: false; reason: string }

/**
 * Read back what the agent proposed and merge it, or refuse it.
 *
 * The file is removed once read, whatever happened: a stale proposal from a
 * previous turn read as this turn's answer is the failure mode that makes a
 * redraft look like it worked.
 */
export function readProposal(order: WorkOrder, proposalPath: string, at: string): ConvergeResult {
  let raw: string
  try {
    raw = fs.readFileSync(proposalPath, 'utf8')
  } catch {
    return { ok: false, reason: 'the architect wrote no proposal' }
  }

  try {
    const proposal = parseProposal(JSON.parse(raw))
    return { ok: true, order: applyProposal(order, proposal, at), note: proposal.note }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ProposalRejected
          ? error.message
          : `the proposal was not readable: ${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    try {
      fs.unlinkSync(proposalPath)
    } catch {
      // Already gone, or never there. Either way there is nothing to clear.
    }
  }
}
