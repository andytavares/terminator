import type { PrChangedFile, PrReviewDetail } from '../../schemas/pr-review.schema'
import { plural } from '@terminator/extension-sdk'
import { choose } from '../text'

type Insights = NonNullable<PrReviewDetail['insights']>

export interface Signal {
  kind: 'complexity' | 'reading' | 'health'
  tone: 'danger' | 'warning' | 'success' | 'neutral'
  label: string
  value: string
  detail: string | null
  source: string
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
  }
}

export function insightsPending(pr: PrReviewDetail): boolean {
  return pr.insights === null
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
    tone: choose(branchDelta > 0, 'warning', 'neutral'),
    label: 'Complexity',
    value: branchChange(branchDelta),
    detail: choose(rising, `Largest: ${largest?.name} +${largest?.branchDelta}`, null),
    source,
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
  if (pr.insights === null) return []
  return [complexitySignal(pr.insights), readingSignal(pr.insights), ...healthSignals(pr.insights)]
}
