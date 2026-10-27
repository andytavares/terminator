// Risk grading. Evaluated strictly top-down, first match wins — and the order
// carries the safety property: P3 is checked LAST, so a lockfile change that
// also touches authentication grades P0 rather than slipping into the only
// lane that needs the least of your attention.
import * as path from 'node:path'
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
  /** The repository's generated dependency lockfiles, as globs (the order's `environment.paths`). */
  readonly lockfiles: readonly string[]
  /** The repository's formatting configuration, as globs. */
  readonly formattingFiles: readonly string[]
}

/** What a P0 file touched, as the order's trigger vocabulary spells it. */
type GradedTrigger = 'authentication' | 'payments' | 'secrets' | 'migration' | 'public_interface'

export interface GradedChange {
  readonly grade: RiskGrade
  /** Set when the change grades P0 by what it touches; the reason above is prose for people. */
  readonly kind?: GradedTrigger
  /** The specific reason, shown on every queue item (FR-050). */
  readonly trigger: string
}

const P0_PATTERNS: ReadonlyArray<{ label: string; kind: GradedTrigger; pattern: RegExp }> = [
  {
    label: 'authentication',
    kind: 'authentication',
    pattern: /(^|\/)(auth|authn|authz|login|session-auth)(\/|\.)/i,
  },
  {
    label: 'payments',
    kind: 'payments',
    pattern: /(^|\/)(payment|payments|billing|charge)(\/|\.)/i,
  },
  {
    label: 'secrets',
    kind: 'secrets',
    pattern: /(^|\/)(secret|secrets|credential|credentials|\.env)/i,
  },
  { label: 'a data migration', kind: 'migration', pattern: /(^|\/)migrations?(\/|_)/i },
  {
    label: 'a public interface',
    kind: 'public_interface',
    pattern: /(extension-sdk|public-api)\/.*\.d\.ts$|\/api\.d\.ts$/i,
  },
]

const SCHEMA_PATTERN = /\.schema\.[jt]s$|(^|\/)schemas?\//i

const LARGE_CHANGE_LINES = 300

/** A glob with no directory in it names a file wherever it sits in the repository. */
export function matchesAnyGlob(file: string, globs: readonly string[]): boolean {
  return globs.some(
    (glob) =>
      path.matchesGlob(file, glob) ||
      (!glob.includes('/') && path.matchesGlob(path.basename(file), glob))
  )
}

/** A generated lockfile: hundreds of lines nobody reviews line by line. */
export function isLockfile(file: string, lockfiles: readonly string[]): boolean {
  return matchesAnyGlob(file, lockfiles)
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
    for (const { label, kind, pattern } of P0_PATTERNS) {
      if (pattern.test(file)) return { grade: 'P0', kind, trigger: `touches ${label}: ${file}` }
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
    change.files.every(
      (file) => isLockfile(file, change.lockfiles) || matchesAnyGlob(file, change.formattingFiles)
    )
  ) {
    return { grade: 'P3', trigger: 'lockfile, formatting or dependency bump with green checks' }
  }
  return null
}
