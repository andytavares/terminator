import type { PrChangedFile, PrReviewDetail } from '../../schemas/pr-review.schema'
import { plural } from '@terminator/extension-sdk'
import { choose } from '../text'

type Insights = NonNullable<PrReviewDetail['insights']>
type RiskLevel = 'high' | 'medium' | 'low'

export interface Signal {
  kind: 'risk' | 'tests' | 'complexity' | 'reading' | 'health'
  tone: 'danger' | 'warning' | 'success' | 'neutral'
  label: string
  value: string
  detail: string | null
  source: string
}

const RISK_SOURCE = 'computeRiskScore · git log, git grep'
const UNTESTED_SHOWN = 3

const RISK_TONE: Record<RiskLevel, Signal['tone']> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
}

const READING_TONE: Record<Insights['understandability']['level'], Signal['tone']> = {
  easy: 'success',
  moderate: 'warning',
  hard: 'danger',
}

function filesOf(pr: PrReviewDetail): PrChangedFile[] {
  return pr.chapters.flatMap((chapter) => chapter.files)
}

function sumOf(files: PrChangedFile[], pick: (file: PrChangedFile) => number): number {
  return files.reduce((total, file) => total + pick(file), 0)
}

export function overviewTotals(pr: PrReviewDetail) {
  const files = filesOf(pr)
  return {
    fileCount: files.length,
    additions: sumOf(files, (file) => file.additions),
    deletions: sumOf(files, (file) => file.deletions),
    minutes: Math.round(sumOf(files, (file) => file.estimatedMinutes)),
  }
}

export function insightsPending(pr: PrReviewDetail): boolean {
  return pr.insights === null
}

function shortPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

function highestFileRisk(files: PrChangedFile[]): RiskLevel {
  if (files.some((file) => file.riskScore.level === 'high')) return 'high'
  if (files.some((file) => file.riskScore.level === 'medium')) return 'medium'
  return 'low'
}

function riskHotspots(measured: PrChangedFile[]): PrChangedFile[] {
  return [...measured]
    .filter((file) => file.riskScore.level !== 'low')
    .sort((a, b) => (b.riskScore.composite ?? 0) - (a.riskScore.composite ?? 0))
    .slice(0, 3)
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function riskSignal(files: PrChangedFile[]): Signal {
  const base = { kind: 'risk', label: 'Risk', source: RISK_SOURCE } as const
  const measured = files.filter((file) => file.riskScore.composite != null)
  if (measured.length === 0) {
    return { ...base, tone: 'neutral', value: 'Not measured', detail: null }
  }
  const level = highestFileRisk(files)
  const [top] = riskHotspots(measured)
  const detail = choose(
    top === undefined,
    null,
    top && `${shortPath(top.path)} (${top.riskScore.dominantDriver})`
  )
  return { ...base, tone: RISK_TONE[level], value: capitalised(level), detail }
}

function branchChange(branchDelta: number): string {
  if (branchDelta === 0) return 'No change'
  const sign = choose(branchDelta > 0, '+', '')
  return `${sign}${branchDelta} branches`
}

function complexitySignal(insights: Insights): Signal {
  const { branchDelta, functions, source } = insights.complexity
  const largest = [...functions].sort((a, b) => b.branchDelta - a.branchDelta)[0]
  const rising = largest !== undefined && largest.branchDelta > 0
  return {
    kind: 'complexity',
    tone: 'neutral',
    label: 'Complexity',
    value: branchChange(branchDelta),
    detail: choose(rising, `Largest: ${largest?.name} +${largest?.branchDelta}`, null),
    source,
  }
}

type Coverage = Insights['coverage']

function coverageValue(coverage: Coverage): string {
  if (coverage.changedFunctions === 0) return 'No functions changed'
  return `${coverage.testedFunctions} of ${coverage.changedFunctions} functions`
}

function untestedDetail(names: string[]): string | null {
  if (names.length === 0) return null
  const shown = names.slice(0, UNTESTED_SHOWN)
  const hidden = names.length - shown.length
  const more = choose(hidden > 0, [`+${hidden} more`], [])
  return `No test: ${[...shown, ...more].join(', ')}`
}

function coverageTone(coverage: Coverage): Signal['tone'] {
  if (coverage.changedFunctions === 0) return 'neutral'
  return choose(coverage.untestedFunctions.length > 0, 'warning', 'success')
}

function testsSignal(insights: Insights): Signal {
  const { coverage } = insights
  return {
    kind: 'tests',
    tone: coverageTone(coverage),
    label: 'Tests',
    value: coverageValue(coverage),
    detail: untestedDetail(coverage.untestedFunctions),
    source: coverage.source,
  }
}

function readingSignal(insights: Insights): Signal {
  const { level, linesToRead, newExports, source } = insights.understandability
  const lines = `${linesToRead.toLocaleString('en-US')} lines`
  return {
    kind: 'reading',
    tone: READING_TONE[level],
    label: 'Reading',
    value: capitalised(level),
    detail: `${lines}, ${newExports} new ${plural(newExports, 'export')}`,
    source,
  }
}

/** Flags counted by kind, in the order each kind first appears. */
function flagGroups(flags: Insights['health']['flags']) {
  const groups: Array<{ kind: string; label: string; count: number }> = []
  for (const flag of flags) {
    const existing = groups.find((group) => group.kind === flag.kind)
    if (existing) existing.count += 1
    else groups.push({ kind: flag.kind, label: flag.label, count: 1 })
  }
  return groups
}

function healthSignals(insights: Insights): Signal[] {
  const { flags, source } = insights.health
  if (flags.length === 0) return []
  const detail = flagGroups(flags)
    .map((group) => `${group.count} ${group.label}`)
    .join(', ')
  const value = `${flags.length} ${plural(flags.length, 'flag')}`
  return [{ kind: 'health', tone: 'warning', label: 'Code health', value, detail, source }]
}

export function overviewSignals(pr: PrReviewDetail): Signal[] {
  const risk = riskSignal(filesOf(pr))
  if (pr.insights === null) return [risk]
  return [
    risk,
    testsSignal(pr.insights),
    complexitySignal(pr.insights),
    readingSignal(pr.insights),
    ...healthSignals(pr.insights),
  ]
}
