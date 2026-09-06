import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadAllRules } from '../recipe/resolve.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { Rule } from '../recipe/parse.js'
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
