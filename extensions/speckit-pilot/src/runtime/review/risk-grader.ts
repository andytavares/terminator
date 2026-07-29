// Risk grading. Evaluated strictly top-down, first match wins — and the order
// carries the safety property: P3 is checked LAST, so a lockfile change that
// also touches authentication grades P0 rather than slipping into the only
// lane that needs the least of your attention.

export type RiskGrade = 'P0' | 'P1' | 'P2' | 'P3'

export type CheckState = 'passing' | 'failing' | 'pending' | 'unavailable'

export interface ChangeSummary {
  readonly files: readonly string[]
  readonly linesChanged: number
  readonly checkState: CheckState
  /** Declared by the work item's contract, when there is one. */
  readonly sharedContractFiles: readonly string[]
  /** Operator-supplied, per repository. Never inferred (FR-055). */
  readonly criticalPaths: readonly string[]
}

export interface GradedChange {
  readonly grade: RiskGrade
  /** The specific reason, shown on every queue item (FR-050). */
  readonly trigger: string
}

const P0_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'authentication', pattern: /(^|\/)(auth|authn|authz|login|session-auth)(\/|\.)/i },
  { label: 'payments', pattern: /(^|\/)(payment|payments|billing|charge)(\/|\.)/i },
  { label: 'secrets', pattern: /(^|\/)(secret|secrets|credential|credentials|\.env)/i },
  { label: 'a data migration', pattern: /(^|\/)migrations?(\/|_)/i },
  { label: 'a public interface', pattern: /(extension-sdk|public-api)\/.*\.d\.ts$|\/api\.d\.ts$/i },
]

const SCHEMA_PATTERN = /\.schema\.[jt]s$|(^|\/)schemas?\//i
const TRIVIAL_PATTERN =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|^\.?[\w.]*(prettier|editorconfig|eslintignore|prettierignore)/i

const LARGE_CHANGE_LINES = 300

/**
 * Minimal glob matching for the two forms an operator writes in a
 * critical-path list: `**` (any depth) and `*` (one segment). Deliberately not
 * a dependency — `minimatch` is only present in this tree by workspace
 * hoisting from an extension, and Constitution IV requires the standard
 * library be used where it fully satisfies the requirement.
 */
export function matchesGlob(file: string, glob: string): boolean {
  const pattern = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?'
      if (part === '**') return '.*'
      if (part === '*') return '[^/]*'
      if (part === '?') return '[^/]'
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${pattern}$`).test(file)
}

function matchesAnyGlob(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(file, glob))
}

export function gradeRisk(change: ChangeSummary): GradedChange {
  // ── P0 ────────────────────────────────────────────────────────────────────
  for (const file of change.files) {
    for (const { label, pattern } of P0_PATTERNS) {
      if (pattern.test(file)) return { grade: 'P0', trigger: `touches ${label}: ${file}` }
    }
    if (matchesAnyGlob(file, change.criticalPaths)) {
      return { grade: 'P0', trigger: `on this repository's critical-path list: ${file}` }
    }
  }

  // ── P1 ────────────────────────────────────────────────────────────────────
  for (const file of change.files) {
    if (SCHEMA_PATTERN.test(file)) return { grade: 'P1', trigger: `alters a schema: ${file}` }
    if (change.sharedContractFiles.includes(file)) {
      return { grade: 'P1', trigger: `alters a declared shared contract: ${file}` }
    }
  }
  if (change.linesChanged > LARGE_CHANGE_LINES) {
    return { grade: 'P1', trigger: `${change.linesChanged} changed lines` }
  }

  // ── P3 ────────────────────────────────────────────────────────────────────
  // Last, and only when every file is trivial AND the checks actually passed.
  // Anything other than `passing` — including an unreachable code host — must
  // not produce a P3, because P3 is the only grade eligible for unattended
  // merge (FR-057, FR-062).
  if (
    change.files.length > 0 &&
    change.checkState === 'passing' &&
    change.files.every((file) => TRIVIAL_PATTERN.test(file))
  ) {
    return { grade: 'P3', trigger: 'lockfile, formatting or dependency bump with green checks' }
  }

  return { grade: 'P2', trigger: 'ordinary feature work' }
}
