import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { CHECK_NAMES, type CheckName } from '../verify/check-names.js'
import { checkVersion, loadYaml, yamlFailure, type ParseResult } from '../recipe/yaml-file.js'
import { globPattern } from './glob.js'
import type { Entry, ProfilePaths } from './schema.js'

// Hints: what a toolchain looks like, as data shipped with the extension
// (`hints/*.yaml`). Reading a repository against them executes nothing and
// writes nothing; a command nothing supports is `null`, never a guess.

const names = z.array(z.string())
const perCheck = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(CHECK_NAMES.map((check) => [check, value.optional()]))).strict()

const ToolRuleSchema = z
  .object({
    command: z.string().min(1),
    /** The rule applies when any of these exists. */
    files: names.default([]),
    /** ...or when any of these files' text matches. */
    matches: z
      .array(z.object({ file: z.string(), pattern: z.string(), flags: z.string().optional() }))
      .default([]),
    /** Put in front of the command when another file exists (`uv run `). */
    prefix: z.object({ when: z.string(), text: z.string() }).optional(),
  })
  .strict()
  .refine((rule) => rule.files.length + rule.matches.length > 0, {
    message: 'a tool rule needs `files` or `matches`',
  })

const HintSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    /** Lower is consulted first, across all hints, within each tier. */
    priority: z.number().int().default(100),
    /** Gates `paths` and `share`: the hint applies where any of these exists. */
    when: names.default([]),
    scripts: z
      .object({
        file: z.string(),
        key: z.string(),
        run: z.string(),
        checks: perCheck(names),
      })
      .strict()
      .optional(),
    tools: perCheck(z.array(ToolRuleSchema)).optional(),
    targets: z.object({ files: names, run: z.string() }).strict().optional(),
    ciRuns: z
      .object({ dir: z.string(), extensions: names, words: perCheck(z.string()) })
      .strict()
      .optional(),
    prepare: z.array(z.object({ when: z.string(), command: z.string() }).strict()).default([]),
    share: names.default([]),
    paths: z
      .object({
        interface: names.default([]),
        manifests: names.default([]),
        lockfiles: names.default([]),
        formatting: names.default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
export type Hint = z.infer<typeof HintSchema>

export interface LoadedHints {
  readonly hints: readonly Hint[]
  /** One line per file that could not be used. */
  readonly problems: readonly string[]
}

function parseHint(text: string, file: string): ParseResult<Hint> {
  const loaded = loadYaml(text, file)
  if (!loaded.ok) return loaded
  const versionProblem = checkVersion(loaded.value, file, 1)
  if (versionProblem !== null) return versionProblem
  const parsed = HintSchema.safeParse(loaded.value)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return yamlFailure(file, `${issue.path.join('.') || 'file'}: ${issue.message}`)
}

/** Every `*.yaml` in `hintsDir`, by priority. A broken file is reported and left out. */
export function loadHints(hintsDir: string): LoadedHints {
  let files: string[]
  try {
    files = fs.readdirSync(hintsDir).filter((file) => /\.ya?ml$/.test(file))
  } catch {
    return { hints: [], problems: [`${hintsDir}: could not be read`] }
  }
  const hints: Hint[] = []
  const problems: string[] = []
  for (const file of files.sort()) {
    const full = path.join(hintsDir, file)
    const result = parseHint(fs.readFileSync(full, 'utf8'), full)
    if (result.ok) hints.push(result.value)
    else problems.push(result.reason)
  }
  return { hints: hints.sort((a, b) => a.priority - b.priority), problems }
}

/** The extension's own `hints/` directory, found from wherever this code runs (source or bundle). */
export function defaultHintsDir(): string {
  let dir = __dirname
  while (!fs.existsSync(path.join(dir, 'hints')) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir)
  }
  return path.join(dir, 'hints')
}

// ---- Reading a repository (read only) ----

/** A file or directory at the repository root; a `*` matches within a root entry's name. */
function present(repo: string, pattern: string): boolean {
  if (!pattern.includes('*')) return fs.existsSync(path.join(repo, pattern))
  try {
    const matcher = globPattern(pattern)
    return fs.readdirSync(repo).some((entry) => matcher.test(entry))
  } catch {
    return false
  }
}

function readText(repo: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(repo, rel), 'utf8')
  } catch {
    return null
  }
}

/** Where a command came from, so the ones the old probe named keep their names. */
type HintTier = 'scripts' | 'tools' | 'targets' | 'ciRuns'

export interface HintProposal extends Entry {
  readonly source: 'hint'
  readonly evidence: string
  readonly tier: HintTier
}

type Proposal = Pick<HintProposal, 'command' | 'evidence'>

/** A manifest's declared scripts. A file that will not parse means no scripts. */
function declaredScripts(repo: string, { file, key }: { file: string; key: string }) {
  try {
    const parsed: unknown = JSON.parse(readText(repo, file) ?? '')
    const table = (parsed as Record<string, unknown> | null)?.[key]
    return typeof table === 'object' && table !== null ? new Set(Object.keys(table)) : new Set()
  } catch {
    return new Set<string>()
  }
}

function fromScripts(repo: string, hint: Hint, check: CheckName): Proposal | null {
  const { scripts } = hint
  const wanted = scripts?.checks[check] as string[] | undefined
  if (scripts === undefined || wanted === undefined) return null
  const declared = declaredScripts(repo, scripts)
  const name = wanted.find((candidate) => declared.has(candidate))
  if (name === undefined) return null
  return { command: scripts.run.replace('{name}', name), evidence: scripts.file }
}

type ToolRule = z.infer<typeof ToolRuleSchema>

function evidenceOfRule(repo: string, rule: ToolRule): string | null {
  const file = rule.files.find((candidate) => present(repo, candidate))
  if (file !== undefined) return file
  const hit = rule.matches.find(({ file: name, pattern, flags }) =>
    new RegExp(pattern, flags).test(readText(repo, name) ?? '')
  )
  return hit === undefined ? null : hit.file
}

function fromTools(repo: string, hint: Hint, check: CheckName): Proposal | null {
  for (const rule of (hint.tools?.[check] as ToolRule[] | undefined) ?? []) {
    const evidence = evidenceOfRule(repo, rule)
    if (evidence === null) continue
    const prefixed = rule.prefix !== undefined && present(repo, rule.prefix.when)
    return { command: `${prefixed ? rule.prefix?.text : ''}${rule.command}`, evidence }
  }
  return null
}

function fromTargets(repo: string, hint: Hint, check: CheckName): Proposal | null {
  if (hint.targets === undefined) return null
  const file = hint.targets.files.find((candidate) => readText(repo, candidate) !== null)
  if (file === undefined) return null
  const target = new RegExp(`^${check}:`, 'm')
  if (!target.test(readText(repo, file) ?? '')) return null
  return { command: hint.targets.run.replace('{name}', check), evidence: file }
}

/** Every shell line of every step's `run`, in file order; a line holding a GitHub expression is no shell. */
function workflowCommands(body: string, file: string): string[] {
  const parsed = loadYaml(body, file)
  const jobs = (parsed.ok ? (parsed.value as { jobs?: unknown } | null)?.jobs : null) ?? {}
  return Object.values(jobs as Record<string, { steps?: Array<{ run?: unknown }> }>)
    .flatMap((job) => job?.steps ?? [])
    .flatMap((step) => (typeof step?.run === 'string' ? step.run.split('\n') : []))
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.includes('${{'))
}

/** The first command, in file order, that the check's words match. */
function runLineMatching(body: string, file: string, words: RegExp): string | null {
  return workflowCommands(body, file).find((command) => words.test(command)) ?? null
}

function fromCiRuns(repo: string, hint: Hint, check: CheckName): Proposal | null {
  const { ciRuns } = hint
  const pattern = ciRuns?.words[check] as string | undefined
  if (ciRuns === undefined || pattern === undefined) return null
  let files: string[]
  try {
    files = fs.readdirSync(path.join(repo, ciRuns.dir))
  } catch {
    return null
  }
  const workflows = files.filter((file) =>
    ciRuns.extensions.some((ext) => file.endsWith(`.${ext}`))
  )
  for (const file of workflows.sort()) {
    const rel = path.posix.join(ciRuns.dir, file)
    const command = runLineMatching(readText(repo, rel) ?? '', rel, new RegExp(pattern, 'i'))
    if (command !== null) return { command, evidence: rel }
  }
  return null
}

// Scripts first, then a tool's own presence, then a Makefile target, then CI:
// from the most specific statement of intent to the least precise.
const TIERS: readonly [
  HintTier,
  (repo: string, hint: Hint, check: CheckName) => Proposal | null,
][] = [
  ['scripts', fromScripts],
  ['tools', fromTools],
  ['targets', fromTargets],
  ['ciRuns', fromCiRuns],
]

function proposeCheck(repo: string, hints: readonly Hint[], check: CheckName): HintProposal | null {
  for (const [tier, read] of TIERS) {
    for (const hint of hints) {
      const found = read(repo, hint, check)
      if (found !== null) return { ...found, source: 'hint', tier }
    }
  }
  return null
}

export interface HintEvaluation {
  readonly checks: Record<CheckName, HintProposal | null>
  readonly prepare: HintProposal | null
  readonly share: readonly string[]
  readonly paths: ProfilePaths
}

function prepareOf(repo: string, hints: readonly Hint[]): HintProposal | null {
  for (const hint of hints) {
    const step = hint.prepare.find((candidate) => present(repo, candidate.when))
    if (step !== undefined) {
      return { command: step.command, evidence: step.when, source: 'hint', tier: 'tools' }
    }
  }
  return null
}

const unique = (values: readonly string[]): string[] => [...new Set(values)]

function applicable(repo: string, hints: readonly Hint[]): Hint[] {
  return hints.filter((hint) => hint.when.length === 0 || hint.when.some((f) => present(repo, f)))
}

/** What these hints propose for `repo`. Reads only. */
export function evaluateHints(repo: string, hints: readonly Hint[]): HintEvaluation {
  const checks = {} as Record<CheckName, HintProposal | null>
  for (const check of CHECK_NAMES) checks[check] = proposeCheck(repo, hints, check)
  const fitting = applicable(repo, hints)
  const pathsOf = (key: keyof ProfilePaths) =>
    unique(fitting.flatMap((hint) => hint.paths?.[key] ?? []))
  return {
    checks,
    prepare: prepareOf(repo, hints),
    share: unique(fitting.flatMap((hint) => hint.share)),
    paths: {
      interface: pathsOf('interface'),
      manifests: pathsOf('manifests'),
      lockfiles: pathsOf('lockfiles'),
      formatting: pathsOf('formatting'),
    },
  }
}
