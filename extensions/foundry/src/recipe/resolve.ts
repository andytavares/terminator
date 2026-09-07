import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseRecipe, parseRole, parseRule } from './parse.js'
import type { ParseResult, Recipe, Role, Rule } from './parse.js'

// Resolving a recipe, role or rule by name.
//
// Three rungs, most specific first. The middle one is what keeps both promises
// at once: a repository *may* carry its own definitions and they win, but no
// repository is ever required to have any — and Foundry never creates that
// directory, because writing into a target repository is the one thing it does
// not do.

export type Kind = 'recipes' | 'roles' | 'rules'

export type Rung = 'data-root' | 'repository' | 'built-in'

export interface ResolvedFile {
  readonly name: string
  readonly rung: Rung
  readonly file: string
  readonly text: string
}

export interface ResolveSources {
  /** The operator's own definitions. Applies everywhere. */
  readonly dataRoot: string
  /** Repositories the order names. Honoured when present, never created. */
  readonly repoPaths: readonly string[]
  /** Ships with the extension. Always available. */
  readonly builtInDir: string
}

function readIfPresent(dir: string, name: string): { file: string; text: string } | null {
  for (const extension of ['.yaml', '.yml']) {
    const file = path.join(dir, `${name}${extension}`)
    try {
      return { file, text: fs.readFileSync(file, 'utf8') }
    } catch {
      // Not here. Try the next extension, then the next rung.
    }
  }
  return null
}

/** Every place a name could come from, most specific first. */
function candidates(kind: Kind, name: string, sources: ResolveSources): [Rung, string][] {
  return [
    ['data-root' as Rung, path.join(sources.dataRoot, kind)],
    ...sources.repoPaths.map(
      (repo) => ['repository' as Rung, path.join(repo, '.foundry', kind)] as [Rung, string]
    ),
    ['built-in' as Rung, path.join(sources.builtInDir, kind)],
  ]
}

/**
 * The file behind a name, and which rung it came from.
 *
 * The rung is returned rather than discarded because "which recipe ran" is not
 * the whole answer — "and which of the three it came from" is what makes a
 * surprising run explicable, and it is recorded in the ledger for that reason.
 */
export function resolveFile(
  kind: Kind,
  name: string,
  sources: ResolveSources
): ResolvedFile | null {
  for (const [rung, dir] of candidates(kind, name, sources)) {
    const found = readIfPresent(dir, name)
    if (found !== null) return { name, rung, file: found.file, text: found.text }
  }
  return null
}

/** Every name available across all three rungs, most specific winning. */
export function availableNames(kind: Kind, sources: ResolveSources): string[] {
  const seen = new Set<string>()
  for (const [, dir] of candidates(kind, '', sources)) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const match = /^(.+)\.ya?ml$/.exec(entry)
      if (match !== null) seen.add(match[1])
    }
  }
  return [...seen].sort()
}

export interface Resolved<T> {
  readonly value: T
  readonly rung: Rung
  readonly file: string
}

function resolveParsed<T>(
  kind: Kind,
  name: string,
  sources: ResolveSources,
  parse: (text: string, file: string) => ParseResult<T>
): { ok: true; resolved: Resolved<T> } | { ok: false; reason: string } {
  const found = resolveFile(kind, name, sources)
  if (found === null) return { ok: false, reason: `No ${kind.slice(0, -1)} called "${name}".` }
  const parsed = parse(found.text, path.basename(found.file))
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  return { ok: true, resolved: { value: parsed.value, rung: found.rung, file: found.file } }
}

export function resolveRecipe(name: string, sources: ResolveSources) {
  return resolveParsed<Recipe>('recipes', name, sources, parseRecipe)
}

export function resolveRole(name: string, sources: ResolveSources) {
  return resolveParsed<Role>('roles', name, sources, parseRole)
}

export function resolveRule(name: string, sources: ResolveSources) {
  return resolveParsed<Rule>('rules', name, sources, parseRule)
}

/**
 * Every rule that loads, with the malformed ones reported rather than thrown.
 *
 * One bad file in the operator's directory must not take the whole rule set
 * with it — the same reasoning the existing work-item reader applies to
 * agent-written JSON.
 */
export function loadAllRules(sources: ResolveSources): { rules: Rule[]; problems: string[] } {
  const rules: Rule[] = []
  const problems: string[] = []
  for (const name of availableNames('rules', sources)) {
    const result = resolveRule(name, sources)
    if (result.ok) rules.push(result.resolved.value)
    else problems.push(result.reason)
  }
  return { rules, problems }
}
