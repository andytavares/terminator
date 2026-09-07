import * as fs from 'node:fs'
import * as path from 'node:path'

// What this project actually runs, discovered rather than assumed.
//
// This is the module that makes "works in any repository, with nothing
// installed into it" true instead of a claim. There is no hardcoded
// `npm run lint` anywhere downstream; the ladder executes what this found.
//
// Two rules it never breaks. It only reads — FR-070 forbids side effects in a
// target repository, and running an unfamiliar project's scripts during intake
// is exactly the surprise this design exists to avoid. And a command it cannot
// find is `null`, never a guess: `null` is what makes "not measured" reachable,
// and a check that reports a pass it did not earn is the failure mode that
// makes an unattended factory dangerous.

export const CHECK_NAMES = ['test', 'lint', 'format', 'coverage', 'e2e', 'build'] as const

export type CheckName = (typeof CHECK_NAMES)[number]

export type ProbeSource = 'package.json' | 'config' | 'makefile' | 'ci'

export interface ProbedCommand {
  readonly command: string
  readonly source: ProbeSource
}

export type Toolchain = Record<CheckName, ProbedCommand | null>

/** Script names that mean each check, in preference order. Exact keys only. */
const SCRIPT_NAMES: Record<CheckName, readonly string[]> = {
  test: ['test'],
  lint: ['lint'],
  format: ['format'],
  coverage: ['test:coverage', 'coverage'],
  e2e: ['test:e2e', 'e2e'],
  build: ['build'],
}

function readText(repo: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(repo, rel), 'utf8')
  } catch {
    return null
  }
}

function exists(repo: string, rel: string): boolean {
  return fs.existsSync(path.join(repo, rel))
}

function existsAny(repo: string, rels: readonly string[]): boolean {
  return rels.some((rel) => exists(repo, rel))
}

/**
 * A project's declared scripts.
 *
 * Tolerant by design, as the retiring self-review reader was: a package.json
 * that will not parse means "no scripts", not a thrown probe.
 */
function scriptsOf(repo: string): Record<string, string> {
  const raw = readText(repo, 'package.json')
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const scripts = (parsed as { scripts?: unknown }).scripts
    if (typeof scripts !== 'object' || scripts === null) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function fromScripts(scripts: Record<string, string>, check: CheckName): ProbedCommand | null {
  for (const name of SCRIPT_NAMES[check]) {
    if (Object.hasOwn(scripts, name)) {
      return { command: `npm run ${name}`, source: 'package.json' }
    }
  }
  return null
}

const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts']
const JEST_CONFIGS = ['jest.config.ts', 'jest.config.js', 'jest.config.cjs']
const ESLINT_CONFIGS = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
]
const PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js']
const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js']

/** The tool's own presence, when no script named the check. */
function fromConfig(repo: string, check: CheckName): ProbedCommand | null {
  const cargo = exists(repo, 'Cargo.toml')
  const go = exists(repo, 'go.mod')
  const pyproject = readText(repo, 'pyproject.toml')

  switch (check) {
    case 'test':
      if (existsAny(repo, VITEST_CONFIGS)) return { command: 'npx vitest run', source: 'config' }
      if (existsAny(repo, JEST_CONFIGS)) return { command: 'npx jest', source: 'config' }
      if (pyproject !== null && pyproject.includes('pytest')) {
        return { command: 'pytest', source: 'config' }
      }
      if (cargo) return { command: 'cargo test', source: 'config' }
      if (go) return { command: 'go test ./...', source: 'config' }
      return null
    case 'lint':
      if (existsAny(repo, ESLINT_CONFIGS)) return { command: 'npx eslint .', source: 'config' }
      if (cargo) return { command: 'cargo clippy', source: 'config' }
      return null
    case 'format':
      if (existsAny(repo, PRETTIER_CONFIGS)) {
        return { command: 'npx prettier --check .', source: 'config' }
      }
      if (cargo) return { command: 'cargo fmt --check', source: 'config' }
      return null
    case 'e2e':
      if (existsAny(repo, PLAYWRIGHT_CONFIGS)) {
        return { command: 'npx playwright test', source: 'config' }
      }
      return null
    case 'build':
      if (cargo) return { command: 'cargo build', source: 'config' }
      if (go) return { command: 'go build ./...', source: 'config' }
      return null
    case 'coverage':
      // Deliberately not inferred. A test runner's presence says nothing about
      // whether this project measures coverage, and guessing a command here
      // would produce a check that fails for a reason the project never chose.
      return null
  }
}

/** A Makefile target whose name is the check. */
function fromMakefile(repo: string, check: CheckName): ProbedCommand | null {
  const makefile = readText(repo, 'Makefile') ?? readText(repo, 'makefile')
  if (makefile === null) return null
  const target = new RegExp(`^${check}:`, 'm')
  return target.test(makefile) ? { command: `make ${check}`, source: 'makefile' } : null
}

/** Words that identify a run step as belonging to a check. */
const CI_WORDS: Record<CheckName, RegExp> = {
  test: /(^|\s)tests?(\s|$)/i,
  lint: /(^|\s)lint(\s|$)/i,
  format: /(^|\s)(format|fmt)(\s|$)/i,
  coverage: /(^|\s)coverage(\s|$)/i,
  e2e: /(^|\s)(e2e|playwright|cypress)(\s|$)/i,
  build: /(^|\s)build(\s|$)/i,
}

/**
 * The CI workflow, last.
 *
 * What CI runs is by definition what the project considers its gate, so it is
 * a legitimate source — but it is the least precise one, which is why it is
 * consulted only when nothing better named the check.
 */
function fromCi(repo: string, check: CheckName): ProbedCommand | null {
  const dir = path.join(repo, '.github', 'workflows')
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  } catch {
    return null
  }
  for (const file of files.sort()) {
    let body: string
    try {
      body = fs.readFileSync(path.join(dir, file), 'utf8')
    } catch {
      continue
    }
    for (const line of body.split('\n')) {
      const run = /^\s*-?\s*run:\s*(.+?)\s*$/.exec(line)
      if (run === null) continue
      const command = run[1].replace(/^['"]|['"]$/g, '')
      if (command.startsWith('|') || command === '') continue
      if (CI_WORDS[check].test(command)) return { command, source: 'ci' }
    }
  }
  return null
}

/**
 * The commands this project actually uses, or null where it has none.
 *
 * Reads only. Executes nothing. Writes nothing.
 */
export function probeToolchain(repoPath: string): Toolchain {
  const scripts = scriptsOf(repoPath)
  const out = {} as Record<CheckName, ProbedCommand | null>
  for (const check of CHECK_NAMES) {
    out[check] =
      fromScripts(scripts, check) ??
      fromConfig(repoPath, check) ??
      fromMakefile(repoPath, check) ??
      fromCi(repoPath, check)
  }
  return out
}

/** The checks this project cannot run, so the operator learns before work starts. */
export function unavailableChecks(toolchain: Toolchain): CheckName[] {
  return CHECK_NAMES.filter((name) => toolchain[name] === null)
}
