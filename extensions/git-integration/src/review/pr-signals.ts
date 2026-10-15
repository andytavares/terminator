import type {
  PrChangedFile,
  PrReviewDetail,
  RiskScore,
  FileMetrics,
  SignalDots,
} from '../schemas/pr-review.schema'
import type { RawFileMetrics } from '../api/github'
import {
  BLAST_HIGH_IMPORTERS,
  BLAST_MEDIUM_IMPORTERS,
  CHURN_HIGH_COMMITS,
  CHURN_MEDIUM_COMMITS,
} from './risk-thresholds'
import { computeRiskScore, queueRiskLevel } from '../github/pr-review-service'

type RiskLevel = RiskScore['level']

/** A changed file with the metrics gathered for it. */
export interface MeasuredFile {
  file: PrChangedFile
  metrics: FileMetrics
}

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }

const CI_DOTS: Record<PrReviewDetail['ciStatus'], SignalDots['ci']> = {
  passing: 'pass',
  failing: 'fail',
  pending: 'warn',
  none: 'unknown',
}

/** The files risk scoring looks at: everything but lock files and generated output (tier 3). */
export function scoredFiles(pr: PrReviewDetail): PrChangedFile[] {
  return pr.chapters.flatMap((c) => c.files).filter((f) => f.tier !== 3)
}

function orDefault<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback
}

function fileMetricsFrom(file: PrChangedFile, raw: RawFileMetrics): FileMetrics {
  return {
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    churn90d: orDefault(raw.churn90d, null),
    blastRadius: orDefault(raw.blastRadius, null),
    testFilePresent: orDefault(raw.testFilePresent, false),
    complexityDelta: null,
    patchCoverage: orDefault(raw.patchCoverage, null),
    topImporters: orDefault(raw.topImporters, []),
    importerCount: orDefault(raw.importerCount, 0),
  }
}

/** Each file the metrics answer covers, with its metrics. */
export function measuredFiles(
  files: PrChangedFile[],
  byPath: Record<string, RawFileMetrics>
): MeasuredFile[] {
  return files
    .filter((file) => byPath[file.path])
    .map((file) => ({ file, metrics: fileMetricsFrom(file, byPath[file.path]) }))
}

/** Every file's risk score, each scaled against the others. */
export function riskScores(measured: MeasuredFile[]): Record<string, RiskScore> {
  const all = measured.map((m) => m.metrics)
  return Object.fromEntries(
    measured.map(({ file, metrics }) => [file.path, computeRiskScore(metrics, all)])
  )
}

/** One high file makes the PR high; three medium files, or 30% of them, do too. */
function fileRiskLevel(levels: RiskLevel[]): RiskLevel {
  const highCount = levels.filter((l) => l === 'high').length
  const medCount = levels.filter((l) => l === 'medium').length
  if (highCount > 0 || medCount >= 3) return 'high'
  if (levels.length > 0 && medCount / levels.length >= 0.3) return 'high'
  if (medCount > 0) return 'medium'
  return 'low'
}

/** The PR's risk from its files, never below the queue's size-based level, so a large but simple
 *  PR is not downgraded out of the High-risk filter once opened. */
export function prRiskLevel(
  measured: MeasuredFile[],
  scores: Record<string, RiskScore>
): RiskLevel {
  const fromFiles = fileRiskLevel(measured.map((m) => scores[m.file.path].level))
  const changeSize = measured.reduce((s, m) => s + m.metrics.additions + m.metrics.deletions, 0)
  const sizeFloor = queueRiskLevel(changeSize)
  if (RISK_RANK[sizeFloor] >= RISK_RANK[fromFiles]) return sizeFloor
  return fromFiles
}

function averageCoverage(measured: MeasuredFile[]): number | null {
  const values = measured.map((m) => m.metrics.patchCoverage).filter((v): v is number => v != null)
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Local patch coverage when there is any; else the codecov/coveralls check, so a passing CI shows. */
function coverageDot(measured: MeasuredFile[], pr: PrReviewDetail): SignalDots['coverage'] {
  const avg = averageCoverage(measured)
  if (avg == null) return pr.coverageStatus ?? 'unknown'
  if (avg >= 80) return 'pass'
  if (avg >= 50) return 'warn'
  return 'fail'
}

/** 'fail' at or over `failFloor`, 'warn' at or over `warnFloor`, else 'pass'; the file level's floors. */
function thresholdDot(value: number, warnFloor: number, failFloor: number): SignalDots['churn'] {
  if (value >= failFloor) return 'fail'
  if (value >= warnFloor) return 'warn'
  return 'pass'
}

export function signalDots(measured: MeasuredFile[], pr: PrReviewDetail): SignalDots {
  const maxChurn = Math.max(...measured.map((m) => m.metrics.churn90d ?? 0))
  const maxBlast = Math.max(...measured.map((m) => m.metrics.blastRadius ?? 0))
  const anyMissingTest = measured.some((m) => !m.metrics.testFilePresent)
  return {
    tests: anyMissingTest ? 'fail' : 'pass',
    coverage: coverageDot(measured, pr),
    ci: CI_DOTS[pr.ciStatus] ?? 'unknown',
    lint: pr.lintStatus ?? 'unknown',
    churn: thresholdDot(maxChurn, CHURN_MEDIUM_COMMITS, CHURN_HIGH_COMMITS),
    blast: thresholdDot(maxBlast, BLAST_MEDIUM_IMPORTERS, BLAST_HIGH_IMPORTERS),
  }
}
