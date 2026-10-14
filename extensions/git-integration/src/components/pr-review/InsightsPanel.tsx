import React from 'react'
import type { PrChangedFile, PrReviewDetail } from '../../schemas/pr-review.schema'
import { plural } from '@terminator/extension-sdk'
import { choose } from '../text'
import './insights.css'

interface Props {
  pr: PrReviewDetail
}

const RISK_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
}

const RISK_CLASS: Record<'high' | 'medium' | 'low', string> = {
  high: 'hi',
  medium: 'md',
  low: 'lo',
}

type Insights = NonNullable<PrReviewDetail['insights']>
type RiskLevel = 'high' | 'medium' | 'low'

function shortPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

interface RowProps {
  label: string
  source?: string
  children: React.ReactNode
}

function InsightRow(props: RowProps) {
  return (
    <div className="ib-score" title={props.source}>
      <div className="ib-lbl">{props.label}</div>
      <div className="ib-text">{props.children}</div>
    </div>
  )
}

/** Items joined by commas, each rendered by `render`. */
function CommaList<T>(props: {
  items: T[]
  keyOf: (item: T) => string
  render: (item: T) => React.ReactNode
}) {
  return (
    <>
      {props.items.map((item, i) => (
        <React.Fragment key={props.keyOf(item)}>
          {i > 0 && ', '}
          {props.render(item)}
        </React.Fragment>
      ))}
    </>
  )
}

function branchChange(branchDelta: number): string {
  if (branchDelta === 0) return 'No change'
  const sign = choose(branchDelta > 0, '+', '')
  return `${sign}${branchDelta} branches`
}

function complexityRow(insights: Insights) {
  const { branchDelta, functions, source } = insights.complexity
  const rising = functions.filter((f) => f.branchDelta > 0)
  const top3 = [...rising].sort((a, b) => b.branchDelta - a.branchDelta).slice(0, 3)
  return (
    <InsightRow label="Complexity" source={source}>
      {branchChange(branchDelta)}. {rising.length === 0 && 'No function gained branches.'}
      {rising.length > 0 && (
        <>
          Up in {rising.length} {plural(rising.length, 'function')}. Largest:{' '}
          <CommaList
            items={top3}
            keyOf={(f) => f.name}
            render={(f) => (
              <>
                <code>{f.name}</code> +{f.branchDelta}
              </>
            )}
          />
          .
        </>
      )}
    </InsightRow>
  )
}

const RISK_SOURCE = 'computeRiskScore · git log, git grep'

function riskHotspots(measured: PrChangedFile[]): PrChangedFile[] {
  return [...measured]
    .filter((f) => f.riskScore.level !== 'low')
    .sort((a, b) => (b.riskScore.composite ?? 0) - (a.riskScore.composite ?? 0))
    .slice(0, 3)
}

function Hotspots({ hotspots }: { hotspots: PrChangedFile[] }) {
  if (hotspots.length === 0) return <>No file stands out.</>
  return (
    <>
      Hotspots:{' '}
      <CommaList
        items={hotspots}
        keyOf={(f) => f.path}
        render={(f) => (
          <>
            <code title={f.path}>{shortPath(f.path)}</code> ({f.riskScore.dominantDriver})
          </>
        )}
      />
      .
    </>
  )
}

function riskRow(allFiles: PrChangedFile[]) {
  const measured = allFiles.filter((f) => f.riskScore.composite != null)
  if (measured.length === 0) {
    return (
      <InsightRow label="Risk" source={RISK_SOURCE}>
        Not measured. Not enough measured files to rank drivers.
      </InsightRow>
    )
  }
  const maxComposite = Math.max(...measured.map((f) => f.riskScore.composite as number))
  return (
    <InsightRow label="Risk" source={RISK_SOURCE}>
      Highest score {maxComposite} / 100. <Hotspots hotspots={riskHotspots(measured)} />
    </InsightRow>
  )
}

type Coverage = Insights['coverage']

function coverageValue(coverage: Coverage): string {
  if (coverage.changedFunctions === 0) return 'No functions changed'
  return `${coverage.testedFunctions} of ${coverage.changedFunctions} functions tested`
}

function UntestedFunctions({ names }: { names: string[] }) {
  const lead = choose(
    names.length === 1,
    '1 changed function has',
    `${names.length} changed functions have`
  )
  return (
    <>
      {lead} no test: <CommaList items={names} keyOf={(n) => n} render={(n) => <code>{n}</code>} />.
    </>
  )
}

function coverageText(coverage: Coverage): React.ReactNode {
  if (coverage.untestedFunctions.length > 0) {
    return <UntestedFunctions names={coverage.untestedFunctions} />
  }
  if (coverage.changedFunctions > 0) return 'Every changed function has a test.'
  if (coverage.changedSourceFiles > 0) {
    return `${coverage.changedSourceFilesWithTests} of ${coverage.changedSourceFiles} changed source files have a changed test beside them.`
  }
  return 'No source files changed.'
}

function coverageRow(insights: Insights) {
  const coverage = insights.coverage
  const { patchPercent } = coverage
  return (
    <InsightRow label="Test coverage" source={coverage.source}>
      {coverageValue(coverage)}. {coverageText(coverage)}
      {patchPercent != null && <> CI reports {patchPercent}% of new lines covered.</>}
    </InsightRow>
  )
}

/** Flags counted by kind, in the order each kind first appears. */
function flagGroups(flags: Insights['health']['flags']) {
  const groups: Array<{ kind: string; label: string; count: number }> = []
  for (const flag of flags) {
    const existing = groups.find((g) => g.kind === flag.kind)
    if (existing) existing.count += 1
    else groups.push({ kind: flag.kind, label: flag.label, count: 1 })
  }
  return groups
}

function healthText(flags: Insights['health']['flags']): string {
  if (flags.length === 0) return 'No flags raised.'
  const groups = flagGroups(flags).map((g) => `${g.count} ${g.label}`)
  return `${flags.length} ${plural(flags.length, 'flag')}: ${groups.join(', ')}.`
}

function healthRow(insights: Insights) {
  const { flags, source } = insights.health
  return (
    <InsightRow label="Code health" source={source}>
      {healthText(flags)}
    </InsightRow>
  )
}

function understandabilityRow(insights: Insights) {
  const { level, linesToRead, newExports, longestChain, source } = insights.understandability
  const value = level.charAt(0).toUpperCase() + level.slice(1)
  return (
    <InsightRow label="Understandability" source={source}>
      {value}. {linesToRead.toLocaleString()} lines to read once formatting and lock files are set
      aside. {newExports} new exported {plural(newExports, 'symbol')}. Longest chain of definitions
      you must hold: {longestChain}.
    </InsightRow>
  )
}

function prRiskLevel(allFiles: PrChangedFile[]): RiskLevel {
  if (allFiles.some((f) => f.riskScore.level === 'high')) return 'high'
  if (allFiles.some((f) => f.riskScore.level === 'medium')) return 'medium'
  return 'low'
}

function InsightsBar({ allFiles }: { allFiles: PrChangedFile[] }) {
  const riskLevel = prRiskLevel(allFiles)
  const totalMinutes = allFiles.reduce((s, f) => s + f.estimatedMinutes, 0)
  const additions = allFiles.reduce((s, f) => s + f.additions, 0)
  const deletions = allFiles.reduce((s, f) => s + f.deletions, 0)
  return (
    <div className="ib-bar">
      <span className="ib-t">What to look at</span>
      <span className={`ib-risk ib-risk--${RISK_CLASS[riskLevel]}`}>{RISK_LABEL[riskLevel]}</span>
      <span>
        about {totalMinutes} min · {allFiles.length} {plural(allFiles.length, 'file')}, +{additions}{' '}
        −{deletions}
      </span>
    </div>
  )
}

function InsightRows({ insights }: { insights: Insights }) {
  return (
    <>
      {complexityRow(insights)}
      {coverageRow(insights)}
      {healthRow(insights)}
      {understandabilityRow(insights)}
    </>
  )
}

export function InsightsPanel({ pr }: Props) {
  const allFiles = pr.chapters.flatMap((c) => c.files)
  return (
    <div className="ib-card">
      <InsightsBar allFiles={allFiles} />
      {riskRow(allFiles)}
      {pr.insights === null && (
        <div className="ib-score ib-score--single">
          <div className="ib-muted">Analysing this PR…</div>
        </div>
      )}
      {pr.insights !== null && <InsightRows insights={pr.insights} />}
    </div>
  )
}
