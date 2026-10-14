// Risk grading. Evaluated strictly top-down, first match wins — and the order
// carries the safety property: P3 is checked LAST, so a lockfile change that
// also touches authentication grades P0 rather than slipping into the only
// lane that needs the least of your attention.
import { matchesGlob } from 'node:path'
import type { RiskGrade } from './risk-grade.js'

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
const FORMATTING_PATTERN = /^\.?[\w.]*(prettier|editorconfig|eslintignore|prettierignore)/i

const LARGE_CHANGE_LINES = 300

/** A generated lockfile: hundreds of lines nobody reviews line by line. */
export function isLockfile(file: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(file)
}

function matchesAnyGlob(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(file, glob))
}

export function gradeRisk(change: ChangeSummary): GradedChange {
  return (
    p0Of(change) ??
    p1Of(change) ??
    p3Of(change) ?? { grade: 'P2', trigger: 'ordinary feature work' }
  )
}

// ── P0 ────────────────────────────────────────────────────────────────────
function p0Of(change: ChangeSummary): GradedChange | null {
  for (const file of change.files) {
    for (const { label, pattern } of P0_PATTERNS) {
      if (pattern.test(file)) return { grade: 'P0', trigger: `touches ${label}: ${file}` }
    }
    if (matchesAnyGlob(file, change.criticalPaths)) {
      return { grade: 'P0', trigger: `on this repository's critical-path list: ${file}` }
    }
  }
  return null
}

// ── P1 ────────────────────────────────────────────────────────────────────
function p1Of(change: ChangeSummary): GradedChange | null {
  for (const file of change.files) {
    if (SCHEMA_PATTERN.test(file)) return { grade: 'P1', trigger: `alters a schema: ${file}` }
    if (change.sharedContractFiles.includes(file)) {
      return { grade: 'P1', trigger: `alters a declared shared contract: ${file}` }
    }
  }
  if (change.linesChanged > LARGE_CHANGE_LINES) {
    return { grade: 'P1', trigger: `${change.linesChanged} changed lines` }
  }
  return null
}

// ── P3 ── last, and only when every file is trivial and the checks passed: anything
// else, an unreachable host too, must not grade P3, the one grade eligible for
// unattended merge (FR-057, FR-062).
function p3Of(change: ChangeSummary): GradedChange | null {
  if (
    change.files.length > 0 &&
    change.checkState === 'passing' &&
    change.files.every((file) => isLockfile(file) || FORMATTING_PATTERN.test(file))
  ) {
    return { grade: 'P3', trigger: 'lockfile, formatting or dependency bump with green checks' }
  }
  return null
}
