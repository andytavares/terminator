import React from 'react'
import type { PrChangedFile, PrReviewDetail } from '../../schemas/pr-review.schema'
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

function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
}

function Row({
  label,
  source,
  children,
}: {
  label: string
  source?: string
  children: React.ReactNode
}) {
  return (
    <div className="ib-score" title={source}>
      <div className="ib-lbl">{label}</div>
      <div className="ib-text">{children}</div>
    </div>
  )
}

function complexityRow(insights: PrReviewDetail['insights']) {
  const { branchDelta, functions, source } = insights!.complexity
  const value =
    branchDelta === 0 ? 'No change' : `${branchDelta > 0 ? '+' : ''}${branchDelta} branches`
  const rising = functions.filter((f) => f.branchDelta > 0)
  const top3 = [...rising].sort((a, b) => b.branchDelta - a.branchDelta).slice(0, 3)

  return (
    <Row label="Complexity" source={source}>
      {value}.{' '}
      {rising.length === 0 ? (
        'No function gained branches.'
      ) : (
        <>
          Up in {rising.length} function{rising.length === 1 ? '' : 's'}. Largest:{' '}
          {top3.map((f, i) => (
            <React.Fragment key={f.name}>
              {i > 0 && ', '}
              <code>{f.name}</code> +{f.branchDelta}
            </React.Fragment>
          ))}
          .
        </>
      )}
    </Row>
  )
}

function riskRow(allFiles: PrChangedFile[]) {
  const measured = allFiles.filter((f) => f.riskScore.composite != null)
  if (measured.length === 0) {
    return (
      <Row label="Risk" source={RISK_SOURCE}>
        Not measured. Not enough measured files to rank drivers.
      </Row>
    )
  }
  const hotspots = [...measured]
    .filter((f) => f.riskScore.level !== 'low')
    .sort((a, b) => (b.riskScore.composite ?? 0) - (a.riskScore.composite ?? 0))
    .slice(0, 3)
  const maxComposite = Math.max(...measured.map((f) => f.riskScore.composite as number))

  return (
    <Row label="Risk" source={RISK_SOURCE}>
      Highest score {maxComposite} / 100.{' '}
      {hotspots.length === 0 ? (
        'No file stands out.'
      ) : (
        <>
          Hotspots:{' '}
          {hotspots.map((f, i) => (
            <React.Fragment key={f.path}>
              {i > 0 && ', '}
              <code title={f.path}>{shortPath(f.path)}</code> ({f.riskScore.dominantDriver})
            </React.Fragment>
          ))}
          .
        </>
      )}
    </Row>
  )
}

const RISK_SOURCE = 'computeRiskScore · git log, git grep'

function coverageRow(insights: PrReviewDetail['insights']) {
  const {
    changedFunctions,
    testedFunctions,
    untestedFunctions,
    patchPercent,
    source,
    changedSourceFiles,
    changedSourceFilesWithTests,
  } = insights!.coverage
  const value =
    changedFunctions === 0
      ? 'No functions changed'
      : `${testedFunctions} of ${changedFunctions} functions tested`

  let text: React.ReactNode
  if (untestedFunctions.length > 0) {
    text = (
      <>
        {untestedFunctions.length === 1
          ? '1 changed function has'
          : `${untestedFunctions.length} changed functions have`}{' '}
        no test:{' '}
        {untestedFunctions.map((name, i) => (
          <React.Fragment key={name}>
            {i > 0 && ', '}
            <code>{name}</code>
          </React.Fragment>
        ))}
        .
      </>
    )
  } else if (changedFunctions > 0) {
    text = 'Every changed function has a test.'
  } else if (changedSourceFiles > 0) {
    text = `${changedSourceFilesWithTests} of ${changedSourceFiles} changed source files have a changed test beside them.`
  } else {
    text = 'No source files changed.'
  }

  return (
    <Row label="Test coverage" source={source}>
      {value}. {text}
      {patchPercent != null && <> CI reports {patchPercent}% of new lines covered.</>}
    </Row>
  )
}

function healthRow(insights: PrReviewDetail['insights']) {
  const { flags, source } = insights!.health
  let text = 'No flags raised.'
  if (flags.length > 0) {
    const groups: Array<{ kind: string; label: string; count: number }> = []
    for (const flag of flags) {
      const existing = groups.find((g) => g.kind === flag.kind)
      if (existing) existing.count += 1
      else groups.push({ kind: flag.kind, label: flag.label, count: 1 })
    }
    text = `${flags.length} flag${flags.length === 1 ? '' : 's'}: ${groups.map((g) => `${g.count} ${g.label}`).join(', ')}.`
  }

  return (
    <Row label="Code health" source={source}>
      {text}
    </Row>
  )
}

function understandabilityRow(insights: PrReviewDetail['insights']) {
  const { level, linesToRead, newExports, longestChain, source } = insights!.understandability
  const value = level.charAt(0).toUpperCase() + level.slice(1)

  return (
    <Row label="Understandability" source={source}>
      {value}. {linesToRead.toLocaleString()} lines to read once formatting and lock files are set
      aside. {newExports} new exported symbol{newExports === 1 ? '' : 's'}. Longest chain of
      definitions you must hold: {longestChain}.
    </Row>
  )
}

export function InsightsPanel({ pr }: Props) {
  const allFiles = pr.chapters.flatMap((c) => c.files)
  const highFiles = allFiles.filter((f) => f.riskScore.level === 'high')
  const medFiles = allFiles.filter((f) => f.riskScore.level === 'medium')
  const riskLevel: 'high' | 'medium' | 'low' =
    highFiles.length > 0 ? 'high' : medFiles.length > 0 ? 'medium' : 'low'
  const totalMinutes = allFiles.reduce((s, f) => s + f.estimatedMinutes, 0)
  const additions = allFiles.reduce((s, f) => s + f.additions, 0)
  const deletions = allFiles.reduce((s, f) => s + f.deletions, 0)

  return (
    <div className="ib-card">
      <div className="ib-bar">
        <span className="ib-t">What to look at</span>
        <span className={`ib-risk ib-risk--${RISK_CLASS[riskLevel]}`}>{RISK_LABEL[riskLevel]}</span>
        <span>
          about {totalMinutes} min · {allFiles.length} file{allFiles.length === 1 ? '' : 's'}, +
          {additions} −{deletions}
        </span>
      </div>
      {riskRow(allFiles)}
      {pr.insights === null ? (
        <div className="ib-score ib-score--single">
          <div className="ib-muted">Analysing this PR…</div>
        </div>
      ) : (
        <>
          {complexityRow(pr.insights)}
          {coverageRow(pr.insights)}
          {healthRow(pr.insights)}
          {understandabilityRow(pr.insights)}
        </>
      )}
    </div>
  )
}
