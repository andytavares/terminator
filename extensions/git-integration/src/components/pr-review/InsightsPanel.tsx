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

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n))
}

function complexityRow(insights: PrReviewDetail['insights']) {
  const { branchDelta, functions, source } = insights!.complexity
  const value =
    branchDelta === 0 ? 'No change' : `${branchDelta > 0 ? '+' : ''}${branchDelta} branches`
  const rising = functions.filter((f) => f.branchDelta > 0)
  const top3 = [...rising].sort((a, b) => b.branchDelta - a.branchDelta).slice(0, 3)
  const largest = top3.map((f) => (
    <React.Fragment key={f.name}>
      <code>{f.name}</code> {f.branchDelta > 0 ? '+' : ''}
      {f.branchDelta}
    </React.Fragment>
  ))
  const meterWidth = clampPercent((branchDelta * 100) / 40)
  const meterColor =
    branchDelta <= 0
      ? 'var(--tm-success)'
      : branchDelta > 30
        ? 'var(--tm-danger)'
        : 'var(--tm-warning)'

  return (
    <div className="ib-score">
      <div className="ib-lbl">Complexity</div>
      <div className="ib-val">{value}</div>
      <div>
        {rising.length === 0 ? (
          'No function gained branches'
        ) : (
          <>
            Up in {rising.length} function{rising.length === 1 ? '' : 's'}
          </>
        )}
        {top3.length > 0 && (
          <>
            . Largest:{' '}
            {largest.map((el, i) => (
              <React.Fragment key={i}>
                {i > 0 && ', '}
                {el}
              </React.Fragment>
            ))}
          </>
        )}
        .
        <div className="ib-meter">
          <i style={{ width: `${meterWidth}%`, background: meterColor }} />
        </div>
      </div>
      <div className="ib-src">{source}</div>
    </div>
  )
}

function riskRow(allFiles: PrChangedFile[]) {
  const measured = allFiles.filter((f) => f.riskScore.composite != null)
  const maxComposite = measured.length
    ? Math.max(...measured.map((f) => f.riskScore.composite as number))
    : null
  const value = maxComposite != null ? `${maxComposite} / 100` : 'Not measured'

  const sorted = [...measured].sort(
    (a, b) => (b.riskScore.composite ?? 0) - (a.riskScore.composite ?? 0)
  )
  const distinctDrivers: Array<{ driver: string; path: string }> = []
  for (const f of sorted) {
    if (distinctDrivers.some((d) => d.driver === f.riskScore.dominantDriver)) continue
    distinctDrivers.push({ driver: f.riskScore.dominantDriver, path: f.path })
    if (distinctDrivers.length >= 2) break
  }

  let text: React.ReactNode
  if (distinctDrivers.length === 0) {
    text = 'Not enough measured files to rank drivers.'
  } else {
    text = (
      <>
        Driven by {distinctDrivers[0].driver} (<code>{distinctDrivers[0].path}</code>)
        {distinctDrivers[1] && (
          <>
            {' '}
            and {distinctDrivers[1].driver} (<code>{distinctDrivers[1].path}</code>)
          </>
        )}
        .
      </>
    )
  }

  const meterColor =
    maxComposite == null
      ? undefined
      : maxComposite >= 67
        ? 'var(--tm-danger)'
        : maxComposite >= 34
          ? 'var(--tm-warning)'
          : 'var(--tm-success)'

  return (
    <div className="ib-score">
      <div className="ib-lbl">Risk</div>
      <div className="ib-val">{value}</div>
      <div>
        {text}
        {maxComposite != null && (
          <div className="ib-meter">
            <i style={{ width: `${clampPercent(maxComposite)}%`, background: meterColor }} />
          </div>
        )}
      </div>
      <div className="ib-src">computeRiskScore · git log, git grep</div>
    </div>
  )
}

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

  const pctTested = changedFunctions > 0 ? (testedFunctions * 100) / changedFunctions : null
  const meterColor =
    pctTested == null
      ? undefined
      : pctTested >= 80
        ? 'var(--tm-success)'
        : pctTested >= 50
          ? 'var(--tm-warning)'
          : 'var(--tm-danger)'

  return (
    <div className="ib-score">
      <div className="ib-lbl">Test coverage</div>
      <div className="ib-val">{value}</div>
      <div>
        {text}
        {patchPercent != null && <> CI reports {patchPercent}% of new lines covered.</>}
        {pctTested != null && (
          <div className="ib-meter">
            <i style={{ width: `${clampPercent(pctTested)}%`, background: meterColor }} />
          </div>
        )}
      </div>
      <div className="ib-src">{source}</div>
    </div>
  )
}

function healthRow(insights: PrReviewDetail['insights']) {
  const { flags, source } = insights!.health
  const value =
    flags.length > 0 ? `${flags.length} flag${flags.length === 1 ? '' : 's'}` : 'No flags'

  let text = 'No flags raised.'
  if (flags.length > 0) {
    const groups: Array<{ kind: string; label: string; count: number }> = []
    for (const flag of flags) {
      const existing = groups.find((g) => g.kind === flag.kind)
      if (existing) existing.count += 1
      else groups.push({ kind: flag.kind, label: flag.label, count: 1 })
    }
    text = `${groups.map((g) => `${g.count} ${g.label}`).join(', ')}.`
  }

  return (
    <div className="ib-score">
      <div className="ib-lbl">Code health</div>
      <div className="ib-val">{value}</div>
      <div>{text}</div>
      <div className="ib-src">{source}</div>
    </div>
  )
}

const UNDERSTANDABILITY_METER: Record<
  'easy' | 'moderate' | 'hard',
  { width: number; color: string }
> = {
  easy: { width: 25, color: 'var(--tm-success)' },
  moderate: { width: 48, color: 'var(--tm-warning)' },
  hard: { width: 80, color: 'var(--tm-danger)' },
}

function understandabilityRow(insights: PrReviewDetail['insights']) {
  const { level, linesToRead, newExports, longestChain, source } = insights!.understandability
  const value = level.charAt(0).toUpperCase() + level.slice(1)
  const meter = UNDERSTANDABILITY_METER[level]

  return (
    <div className="ib-score">
      <div className="ib-lbl">Understandability</div>
      <div className="ib-val">{value}</div>
      <div>
        {linesToRead.toLocaleString()} lines to read once formatting and lock files are set aside.{' '}
        {newExports} new exported symbol{newExports === 1 ? '' : 's'}. Longest chain of definitions
        you must hold: {longestChain}.
        <div className="ib-meter">
          <i style={{ width: `${meter.width}%`, background: meter.color }} />
        </div>
      </div>
      <div className="ib-src">{source}</div>
    </div>
  )
}

export function InsightsPanel({ pr }: Props) {
  const allFiles = pr.chapters.flatMap((c) => c.files)
  const highFiles = allFiles.filter((f) => f.riskScore.level === 'high')
  const medFiles = allFiles.filter((f) => f.riskScore.level === 'medium')
  const riskLevel: 'high' | 'medium' | 'low' =
    highFiles.length > 0 ? 'high' : medFiles.length > 0 ? 'medium' : 'low'
  const totalMinutes = allFiles.reduce((s, f) => s + f.estimatedMinutes, 0)

  return (
    <div className="ib-card">
      <div className="ib-bar">
        <span className="ib-t">Review brief · #{pr.number}</span>
        <span className="ib-sp" />
        <span className={`ib-chip ib-chip--${RISK_CLASS[riskLevel]}`}>{RISK_LABEL[riskLevel]}</span>
        <span className="ib-chip">~{totalMinutes} min</span>
      </div>
      {pr.insights === null ? (
        <div className="ib-score ib-score--single">
          <div className="ib-muted">Analysing this PR…</div>
        </div>
      ) : (
        <>
          {complexityRow(pr.insights)}
          {riskRow(allFiles)}
          {coverageRow(pr.insights)}
          {healthRow(pr.insights)}
          {understandabilityRow(pr.insights)}
        </>
      )}
    </div>
  )
}
