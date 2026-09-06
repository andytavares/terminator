import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { CODE_SUFFIX, COVERAGE_DIR, LINT_REPORT, type StepId } from '../runner/self-review-plan.js'
import type { SelfReviewResult } from '../types/speckit.types.js'

// Turning what the checks recorded into what the gate shows.
//
// Every number here is read from a tool's own machine-readable report. Nothing
// is inferred from console text, and nothing a tool did not report is filled
// in: `null` means "not measured", which the gate renders as such. A zero would
// read as "no errors", and a review that says that when it does not know is
// worse than one that says nothing.

/** A step's exit code, or null when it never wrote one. */
function exitCodeOf(outputDir: string, id: StepId): number | null {
  try {
    const raw = readFileSync(path.join(outputDir, `${id}${CODE_SUFFIX}`), 'utf8').trim()
    const code = Number.parseInt(raw, 10)
    return Number.isNaN(code) ? null : code
  } catch {
    return null
  }
}

/** Totals across eslint's per-file results. */
function lintCounts(outputDir: string): { errorCount: number; warningCount: number } | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(outputDir, LINT_REPORT), 'utf8'))
    if (!Array.isArray(parsed)) return null
    let errorCount = 0
    let warningCount = 0
    for (const file of parsed) {
      if (typeof file !== 'object' || file === null) continue
      const entry = file as { errorCount?: unknown; warningCount?: unknown }
      if (typeof entry.errorCount === 'number') errorCount += entry.errorCount
      if (typeof entry.warningCount === 'number') warningCount += entry.warningCount
    }
    return { errorCount, warningCount }
  } catch {
    return null
  }
}

/** Line coverage, from vitest's `json-summary` reporter. */
function coveragePercent(outputDir: string): number | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(outputDir, COVERAGE_DIR, 'coverage-summary.json'), 'utf8')
    )
    if (typeof parsed !== 'object' || parsed === null) return null
    const total = (parsed as { total?: { lines?: { pct?: unknown } } }).total
    const pct = total?.lines?.pct
    return typeof pct === 'number' ? pct : null
  } catch {
    return null
  }
}

/**
 * The summary, or null when the checks left nothing behind.
 *
 * Null rather than an empty result: a phase that never ran and a phase where
 * everything passed must not look the same, and the gate already says where to
 * read the output when there is no summary.
 */
export function readSelfReviewSummary(outputDir: string): SelfReviewResult | null {
  const codes: Record<StepId, number | null> = {
    format: exitCodeOf(outputDir, 'format'),
    lint: exitCodeOf(outputDir, 'lint'),
    test: exitCodeOf(outputDir, 'test'),
    review: exitCodeOf(outputDir, 'review'),
  }
  if (Object.values(codes).every((code) => code === null)) return null

  const counts = lintCounts(outputDir)
  const percentage = coveragePercent(outputDir)
  // A step that recorded no exit code did not run to completion; that is not a
  // pass, and it is not a failure it can be blamed for either.
  const passed = (id: StepId): boolean | null => (codes[id] === null ? null : codes[id] === 0)

  const failures = (['format', 'lint', 'test', 'review'] as const).filter(
    (id) => passed(id) === false
  )
  const unmeasured = (['format', 'lint', 'test', 'review'] as const).filter(
    (id) => passed(id) === null
  )

  return {
    format: { passed: passed('format'), output: null },
    lint: {
      passed: passed('lint'),
      errorCount: counts?.errorCount ?? null,
      warningCount: counts?.warningCount ?? null,
      output: null,
    },
    coverage: { passed: passed('test'), percentage, output: null },
    googleReview: { passed: passed('review'), blockerCount: null, output: null },
    summary: [
      failures.length === 0 ? 'Every check that ran passed.' : `Failed: ${failures.join(', ')}.`,
      unmeasured.length > 0 ? `Did not run: ${unmeasured.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  }
}
