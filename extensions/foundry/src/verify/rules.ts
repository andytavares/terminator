import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadAllRules } from '../recipe/resolve.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { Rule } from '../recipe/parse.js'
import type { Proposal } from '../ledger/curator.js'
import type { Rung } from './ladder.js'

// Which checks apply here.
//
// Universal rules ship with the tool and hold in any repository. Project rules
// hold only where the repository carries what they depend on — `docs-in-pr`
// and `flat-icons` come from one project's constitution, and in a repository
// with no such document they are simply not loaded rather than enforced
// against a standard nobody there agreed to.

export interface RuleContext {
  readonly repoPaths: readonly string[]
  /** What the repository says about itself, as Scout found it. */
  readonly houseDocs: readonly string[]
}

/**
 * What a project rule needs before it applies.
 *
 * The syntax is the same as a recipe requirement, deliberately: one form to
 * learn. `always` is the default and means what it says.
 */
function projectRuleApplies(rule: Rule, context: RuleContext): boolean {
  const condition = rule.appliesWhen.trim()
  if (condition === '' || condition === 'always') return true

  const pathExists = /^path_exists:\s*(.+)$/.exec(condition)
  if (pathExists !== null) {
    const wanted = pathExists[1].trim()
    return context.repoPaths.some((repo) => fs.existsSync(path.join(repo, wanted)))
  }

  const houseDoc = /^house_doc:\s*(.+)$/.exec(condition)
  if (houseDoc !== null) {
    const wanted = houseDoc[1].trim()
    return context.houseDocs.includes(wanted)
  }

  // A condition nothing can evaluate does not apply. Defaulting the other way
  // would enforce a rule against a project that never agreed to it.
  return false
}

export interface LoadedRules {
  readonly rules: readonly Rule[]
  readonly problems: readonly string[]
  /** Project rules that exist but do not apply here, and why. */
  readonly notApplicable: readonly { id: string; reason: string }[]
}

export function rulesFor(sources: ResolveSources, context: RuleContext): LoadedRules {
  const loaded = loadAllRules(sources)
  const rules: Rule[] = []
  const notApplicable: { id: string; reason: string }[] = []

  for (const rule of loaded.rules) {
    if (rule.scope === 'universal') {
      rules.push(rule)
      continue
    }
    if (projectRuleApplies(rule, context)) {
      rules.push(rule)
    } else {
      notApplicable.push({
        id: rule.id,
        reason: `this repository does not satisfy "${rule.appliesWhen}"`,
      })
    }
  }

  return { rules, problems: loaded.problems, notApplicable }
}

/** The rules that belong at one rung of the ladder. */
export function rulesAtRung(rules: readonly Rule[], rung: Rung): Rule[] {
  return rules.filter((rule) => rule.rung === rung)
}

// ── Rules the operator accepted from a proposal ────────────────────────────
//
// Written to the data root, which is rung one of name resolution — so an
// accepted rule is in force from the next run without anything else being
// wired. The derivation travels on the rule itself, so a rule nobody can
// justify later is one whose citations can be read rather than guessed at.

function rulesDir(root: string): string {
  return path.join(root, 'rules')
}

function declinedFile(root: string): string {
  return path.join(rulesDir(root), 'declined.json')
}

/**
 * Accept a proposal. Returns the file it was written to.
 *
 * YAML rather than JSON because this is now a rule like any other, editable by
 * hand and read by the same parser, and a hand-edited rule should look like
 * the ones that ship with the tool.
 */
export async function acceptProposal(root: string, proposal: Proposal): Promise<string> {
  await fs.promises.mkdir(rulesDir(root), { recursive: true })
  const file = path.join(rulesDir(root), `${proposal.id}.yaml`)
  const body = [
    'schemaVersion: 1',
    `id: ${proposal.id}`,
    // Universal: the operator accepted it for their own factory, and the data
    // root is theirs. A rule scoped to a project would need a condition
    // nobody has stated.
    'scope: universal',
    `rung: ${proposal.rung}`,
    'asserts: >',
    ...proposal.asserts.split('\n').map((line) => `  ${line.trim()}`),
    'appliesWhen: always',
    `origin: ${proposal.origin}`,
    '',
  ].join('\n')
  await fs.promises.writeFile(file, body, 'utf8')
  return file
}

async function readDeclined(root: string): Promise<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(declinedFile(root), 'utf8'))
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Turn a proposal down, permanently.
 *
 * Kept rather than forgotten because the alternative is offering it again
 * next week, which is the same failure as not learning from a rejection —
 * just aimed at the operator instead of at the work.
 */
export async function declineProposal(
  root: string,
  proposalId: string,
  reason: string
): Promise<void> {
  await fs.promises.mkdir(rulesDir(root), { recursive: true })
  const declined = { ...(await readDeclined(root)), [proposalId]: reason }
  await fs.promises.writeFile(declinedFile(root), JSON.stringify(declined, null, 2), 'utf8')
}

/** Proposals the operator has already turned down. */
export async function declinedProposals(root: string): Promise<string[]> {
  return Object.keys(await readDeclined(root)).sort()
}

/**
 * Remove an accepted rule.
 *
 * Deleted *and* declined: a rule the operator removed is one they decided
 * against, so proposing it again next time the ledger is read would be the
 * factory arguing with them.
 */
export async function removeRule(root: string, ruleId: string, reason: string): Promise<boolean> {
  let removed = false
  for (const extension of ['.yaml', '.yml']) {
    try {
      await fs.promises.unlink(path.join(rulesDir(root), `${ruleId}${extension}`))
      removed = true
    } catch {
      // Not under that extension. The other one, or not there at all.
    }
  }
  await declineProposal(root, ruleId, reason)
  return removed
}
