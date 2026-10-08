import { GateCard } from './GateCard.js'
import { ruleInWords } from '../gates/rules.js'
import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ShieldAlert,
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  HelpCircle,
  Gauge,
  CheckCircle2,
  Unplug,
  Hand,
} from 'lucide-react'
import type { Gate, GateRuleId } from '../gates/rules.js'
import { ExternalLink, MarkdownInline } from './Markdown.js'
import type { Signal } from '../sensors/types.js'

// The one surface the operator is required to visit.
//
// One queue, always sorted by how much work the decision unblocks. Every row
// names the rule that raised it, shows what it looked at, and says what
// happens if it is ignored — because an interruption the operator cannot
// attribute is one they learn to click through without reading.

interface InboxView {
  gates: (Gate & {
    orderTitle: string | null
    pulls?: { number: number; url: string }[]
    source?: { key: string; url: string } | null
  })[]
  /** Orders waiting on you that no gate stands for, with why. */
  waiting?: { orderId: string; title: string; headline: string; detail: string }[]
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

/** A sensor as `sensors.list` answers it — just enough to label a signal
 *  and offer its own repository as the default a promotion asks for. */
interface SensorRow {
  readonly def: { readonly id: string; readonly description: string }
  readonly state: { readonly repoPath: string | null }
}

/** The evidence a signal was last seen with, most recent first. */
function latestEvidence(signal: Signal): Signal['evidence'][number] | undefined {
  return [...signal.evidence].sort((a, b) => (a.at < b.at ? 1 : -1))[0]
}

const RULE_ICON: Record<GateRuleId, React.ComponentType> = {
  'risk.p0': ShieldAlert,
  'budget.exceeded': Gauge,
  destructive: AlertTriangle,
  'ready-for-review': GitPullRequest,
  'verify.repeat-fail': AlertTriangle,
  'verify.base-fail': AlertTriangle,
  'critical-path': ShieldAlert,
  'new-dependency': AlertTriangle,
  'forge-defect': HelpCircle,
  'unit.boundary': CheckCircle2,
  'run.interrupted': Unplug,
  'ci.red': GitPullRequestClosed,
  'refinery.conflict': GitMerge,
}

/** Severity is carried by a stripe, so what needs attention reads at a glance. */
const RULE_TONE: Record<GateRuleId, string> = {
  'risk.p0': 'is-p0',
  destructive: 'is-p0',
  'critical-path': 'is-p0',
  'budget.exceeded': 'is-warn',
  'verify.repeat-fail': 'is-warn',
  'verify.base-fail': 'is-warn',
  'new-dependency': 'is-warn',
  'forge-defect': 'is-info',
  'unit.boundary': 'is-info',
  'ready-for-review': 'is-ok',
  'run.interrupted': 'is-warn',
  'ci.red': 'is-warn',
  'refinery.conflict': 'is-warn',
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export const SIGNAL_POLL_MS = 4000

export function Inbox({
  onOpenOrder,
}: {
  onOpenOrder?: (orderId: string) => void
} = {}): JSX.Element {
  const [view, setView] = useState<InboxView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [digest, setDigest] = useState<Digest | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [sensors, setSensors] = useState<SensorRow[]>([])
  const [promoting, setPromoting] = useState<string | null>(null)
  const [repoDraft, setRepoDraft] = useState('')
  const [signalProblem, setSignalProblem] = useState<string | null>(null)
  const [promoted, setPromoted] = useState<string | null>(null)

  const refreshSignals = useCallback(async () => {
    const [sig, sen] = await Promise.all([
      invoke('foundry:signals.list') as Promise<{ signals?: Signal[] }>,
      invoke('foundry:sensors.list') as Promise<{ sensors?: SensorRow[] }>,
    ])
    setSignals(sig.signals ?? [])
    setSensors(sen.sensors ?? [])
  }, [])

  const refreshList = useCallback(async () => {
    setView((await invoke('foundry:inbox.list')) as InboxView)
  }, [])

  const refresh = useCallback(async () => {
    await refreshList()
    await refreshSignals()

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
  }, [refreshList, refreshSignals])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Sensors record signals on their own tick, and an order can start waiting
  // on you at any moment, so both are read again while the Inbox is open
  // rather than only when it mounts.
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshSignals()
      void refreshList()
    }, SIGNAL_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshList, refreshSignals])

  const answer = useCallback(
    async (gateId: string, option: string, limit?: number | null) => {
      setBusy(gateId)
      setProblem(null)
      try {
        // Said out loud. This is the control the whole autonomy dial exists to
        // reach: a decision the handler refused — already answered, gate gone,
        // a rule that threw — used to look exactly like one it took, because
        // the reply was thrown away and the list simply redrew.
        const payload = limit === undefined ? { gateId, option } : { gateId, option, limit }
        const result = (await invoke('foundry:inbox.decide', payload)) as {
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

  const startPromote = useCallback(
    (signal: Signal) => {
      const sensor = sensors.find((s) => s.def.id === signal.sensorId)
      setSignalProblem(null)
      setPromoted(null)
      setRepoDraft(sensor?.state.repoPath ?? '')
      setPromoting(signal.id)
    },
    [sensors]
  )

  const confirmPromote = useCallback(
    async (id: string) => {
      setSignalProblem(null)
      const result = (await invoke('foundry:signals.promote', {
        id,
        repoPaths: [repoDraft],
      })) as { order?: { id: string }; error?: string }
      if (result.error !== undefined) {
        setSignalProblem(result.error)
        return
      }
      setPromoting(null)
      setPromoted(`Draft ${result.order?.id ?? ''} created — open it in the Forge`)
      await refreshSignals()
    },
    [repoDraft, refreshSignals]
  )

  const dismissSignal = useCallback(
    async (id: string) => {
      await invoke('foundry:signals.dismiss', { id })
      await refreshSignals()
    },
    [refreshSignals]
  )

  if (view === null) return <div className="fdry-empty">Loading…</div>

  const waiting = view.waiting ?? []

  return (
    <div className="fdry-shell">
      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
      {waiting.length > 0 ? (
        <ul className="fdry-queue" aria-label="Orders waiting on you">
          {waiting.map((row) => (
            <li key={row.orderId} className="fdry-gate is-warn">
              <span className="fdry-gate-stripe" aria-hidden="true" />
              <div className="fdry-waiting">
                <span className="fdry-gate-icon" aria-hidden="true">
                  <Hand />
                </span>
                <div className="fdry-waiting-main">
                  <b>{row.headline}</b>
                  <span className="fdry-waiting-title">{row.title}</span>
                  <p>{row.detail}</p>
                </div>
                <div className="fdry-gate-actions">
                  <button
                    type="button"
                    className="is-primary"
                    aria-label={`Open ${row.title} in the Forge`}
                    onClick={() => onOpenOrder?.(row.orderId)}
                  >
                    Open
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {view.gates.length === 0 && waiting.length > 0 ? null : view.gates.length === 0 ? (
        <div className="fdry-nothing">
          <CheckCircle2 aria-hidden="true" />
          <p>Nothing needs you.</p>
          {(view.silenced?.length ?? 0) > 0 ? (
            <small className="fdry-silenced">
              On <b>{view.autonomy}</b> it decides these for you:{' '}
              {view.silenced?.map((rule) => ruleInWords(rule)).join('; ')}.
            </small>
          ) : null}
          {digest !== null && digest.entryCount > 0 ? (
            <small>
              {digest.entryCount} things happened across {digest.sessionCount}{' '}
              {digest.sessionCount === 1 ? 'run' : 'runs'} since you last looked
              {digest.bySession[0]?.entries[0] !== undefined ? (
                <>
                  {' — most recently: '}
                  <MarkdownInline text={digest.bySession[0].entries[0].summary} />
                </>
              ) : null}
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
                <GateCard
                  gate={gate}
                  busy={busy === gate.id}
                  pulls={gate.pulls}
                  source={gate.source}
                  onDecide={(option, limit) => void answer(gate.id, option, limit)}
                  lead={
                    <>
                      <span className="fdry-gate-icon" aria-hidden="true">
                        <Icon />
                      </span>
                      <code className="fdry-gate-rule" title={ruleInWords(gate.rule)}>
                        {ruleInWords(gate.rule)}
                      </code>
                    </>
                  }
                  meta={
                    <>
                      <span>{gate.orderTitle ?? `work order ${gate.orderId}`}</span>
                      {gate.blockedUnits > 0 ? (
                        <span>{gate.blockedUnits} units waiting</span>
                      ) : null}
                    </>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}

      {signals.length > 0 ? (
        <section className="fdry-signals" aria-label="From the factory's sensors">
          <h2 className="fdry-panel-h">From the factory&rsquo;s sensors</h2>
          {signalProblem !== null ? <p className="fdry-problem">{signalProblem}</p> : null}
          {promoted !== null ? <p className="fdry-note">{promoted}</p> : null}
          <ul className="fdry-signal-list">
            {signals.map((signal) => {
              const sensor = sensors.find((s) => s.def.id === signal.sensorId)
              const evidence = latestEvidence(signal)
              return (
                <li key={signal.id} className="fdry-signal">
                  <div className="fdry-signal-main">
                    <b>{signal.title}</b>
                    <div className="fdry-signal-meta">
                      <span>×{signal.occurrences}</span>
                      <span>{signal.severity}</span>
                      <span>{sensor?.def.description ?? signal.sensorId}</span>
                      {evidence !== undefined ? (
                        <ExternalLink href={evidence.url}>{evidence.title}</ExternalLink>
                      ) : null}
                    </div>
                    {promoting === signal.id ? (
                      <div className="fdry-signal-promote">
                        <label>
                          Repository
                          <input
                            type="text"
                            value={repoDraft}
                            placeholder="/path/to/repo"
                            onChange={(event) => setRepoDraft(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="is-primary"
                          disabled={repoDraft.trim() === ''}
                          onClick={() => void confirmPromote(signal.id)}
                        >
                          Confirm promote
                        </button>
                        <button type="button" onClick={() => setPromoting(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {promoting === signal.id ? null : (
                    <div className="fdry-signal-actions">
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => startPromote(signal)}
                      >
                        Promote
                      </button>
                      <button type="button" onClick={() => void dismissSignal(signal.id)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

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
