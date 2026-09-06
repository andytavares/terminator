import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ShieldAlert,
  GitPullRequest,
  HelpCircle,
  Gauge,
  CheckCircle2,
} from 'lucide-react'
import type { Gate, GateRuleId } from '../gates/rules.js'

// The one surface the operator is required to visit.
//
// One queue, always sorted by how much work the decision unblocks. Every row
// names the rule that raised it, shows what it looked at, and says what
// happens if it is ignored — because an interruption the operator cannot
// attribute is one they learn to click through without reading.

interface InboxView {
  gates: Gate[]
  autonomy?: 'escorted' | 'standard' | 'lights-out'
  /** Rules this setting is not asking about. Shown, so quiet is explicable. */
  silenced?: GateRuleId[]
  summary: {
    waiting: number
    orders: number
    automatic: number
    building: number
    converging: number
  }
}

/** What happened since the operator last looked, rolled up. */
interface Digest {
  entryCount: number
  sessionCount: number
  bySession: { sessionId: string; entries: { summary: string }[] }[]
}

/** Where "since you last looked" is remembered. Per viewer, not per run. */
const LAST_READ_KEY = 'foundry.inbox.lastRead'

const RULE_ICON: Record<GateRuleId, React.ComponentType> = {
  'risk.p0': ShieldAlert,
  'budget.exceeded': Gauge,
  destructive: AlertTriangle,
  'ready-for-review': GitPullRequest,
  'verify.repeat-fail': AlertTriangle,
  'critical-path': ShieldAlert,
  'new-dependency': AlertTriangle,
  'forge-defect': HelpCircle,
  'unit.boundary': CheckCircle2,
}

/** Severity is carried by a stripe, so what needs attention reads at a glance. */
const RULE_TONE: Record<GateRuleId, string> = {
  'risk.p0': 'is-p0',
  destructive: 'is-p0',
  'critical-path': 'is-p0',
  'budget.exceeded': 'is-warn',
  'verify.repeat-fail': 'is-warn',
  'new-dependency': 'is-warn',
  'forge-defect': 'is-info',
  'unit.boundary': 'is-info',
  'ready-for-review': 'is-ok',
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export function Inbox(): JSX.Element {
  const [view, setView] = useState<InboxView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [digest, setDigest] = useState<Digest | null>(null)

  const refresh = useCallback(async () => {
    const next = (await invoke('foundry:inbox.list')) as InboxView
    setView(next)

    // "Nothing needs you" is only reassuring if it also says what happened
    // while you were not looking. When it was is a property of the person
    // reading, not of the runs, so it lives in their own browser.
    let since = Date.now() - 24 * 60 * 60 * 1000
    try {
      const stored = window.localStorage.getItem(LAST_READ_KEY)
      if (stored !== null) since = Number(stored)
    } catch {
      // A private window, or storage turned off. A day is a fine default.
    }
    const rolled = (await invoke('foundry:feed-digest', { from: since })) as Digest
    setDigest(rolled)
    try {
      window.localStorage.setItem(LAST_READ_KEY, String(Date.now()))
    } catch {
      // Nothing here is worth failing the surface for.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const answer = useCallback(
    async (gateId: string, option: string) => {
      setBusy(gateId)
      setProblem(null)
      try {
        // Said out loud. This is the control the whole autonomy dial exists to
        // reach: a decision the handler refused — already answered, gate gone,
        // a rule that threw — used to look exactly like one it took, because
        // the reply was thrown away and the list simply redrew.
        const result = (await invoke('foundry:inbox.decide', { gateId, option })) as {
          error?: string
        }
        if (result.error !== undefined) setProblem(result.error)
        await refresh()
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )

  if (view === null) return <div className="fdry-empty">Loading…</div>

  return (
    <div className="fdry-shell">
      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
      {view.gates.length === 0 ? (
        <div className="fdry-nothing">
          <CheckCircle2 aria-hidden="true" />
          <p>Nothing needs you.</p>
          {(view.silenced?.length ?? 0) > 0 ? (
            <small className="fdry-silenced">
              On <b>{view.autonomy}</b>, not asking about: {view.silenced?.join(', ')}
            </small>
          ) : null}
          {digest !== null && digest.entryCount > 0 ? (
            <small>
              {digest.entryCount} things happened across {digest.sessionCount}{' '}
              {digest.sessionCount === 1 ? 'run' : 'runs'} since you last looked
              {digest.bySession[0]?.entries[0] !== undefined
                ? ` — most recently: ${digest.bySession[0].entries[0].summary}`
                : ''}
            </small>
          ) : null}
        </div>
      ) : (
        <ul className="fdry-queue">
          {view.gates.map((gate) => {
            const Icon = RULE_ICON[gate.rule]
            return (
              <li key={gate.id} className={`fdry-gate ${RULE_TONE[gate.rule]}`}>
                <span className="fdry-gate-stripe" aria-hidden="true" />
                <div className="fdry-gate-main">
                  <div className="fdry-gate-head">
                    <span className="fdry-gate-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <code className="fdry-gate-rule">{gate.rule}</code>
                    <b>{gate.summary}</b>
                  </div>
                  <p className="fdry-gate-why">{gate.why}</p>
                  <div className="fdry-gate-meta">
                    <span>{gate.orderId}</span>
                    {gate.blockedUnits > 0 ? <span>{gate.blockedUnits} units waiting</span> : null}
                    <span>risk {gate.riskGrade}</span>
                    {gate.evidence.map((piece, index) => (
                      <span key={`${piece.kind}-${index}`}>
                        {piece.kind}
                        {piece.exitCode === undefined ? '' : ` ${piece.exitCode}`}
                      </span>
                    ))}
                    <span className="fdry-gate-default">
                      if ignored: {gate.defaultIfIgnored}
                      {gate.deadline === null ? ' (waits)' : ''}
                    </span>
                  </div>
                </div>
                <div className="fdry-gate-actions">
                  {gate.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.consequence}
                      disabled={busy === gate.id}
                      className={option.id === gate.defaultIfIgnored ? '' : 'is-primary'}
                      onClick={() => void answer(gate.id, option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="fdry-queue-foot">
        <span>
          <b>{view.summary.building}</b> orders building
        </span>
        <span>
          <b>{view.summary.converging}</b> converging
        </span>
        <span>
          <b>{view.summary.automatic}</b> decisions taken by rule
        </span>
      </footer>
    </div>
  )
}
