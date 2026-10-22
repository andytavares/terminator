import { GateCard } from './GateCard.js'
import { ruleInWords } from '../gates/rules.js'
import React, { useCallback, useState } from 'react'
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
import { ExternalLink } from './ExternalLink.js'
import { usePushed, ANY_RECORD } from '../renderer/use-pushed.js'
import { Button } from '@terminator/extension-ui'
import type { Signal } from '../sensors/types.js'
import { invoke } from '@terminator/extension-sdk/renderer'
import type { SensorRow } from './signals-read.js'
import { usePromotion, useSignalFeed } from '../renderer/use-signals.js'

// Everything waiting on the operator, as a band above the Forge.
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
}

/** The evidence a signal was last seen with, most recent first. */
function latestEvidence(signal: Signal): Signal['evidence'][number] | undefined {
  return [...signal.evidence].sort((a, b) => (a.at < b.at ? 1 : -1))[0]
}

const RULE_ICON: Record<GateRuleId, React.ComponentType> = {
  'risk.p0': ShieldAlert,
  'budget.exceeded': Gauge,
  'ready-for-review': GitPullRequest,
  'verify.repeat-fail': AlertTriangle,
  'verify.base-fail': AlertTriangle,
  'verify.flaky': AlertTriangle,
  'forge-defect': HelpCircle,
  'unit.boundary': CheckCircle2,
  'run.interrupted': Unplug,
  'ci.red': GitPullRequestClosed,
  'refinery.conflict': GitMerge,
}

/** Severity is carried by a stripe, so what needs attention reads at a glance. */
const RULE_TONE: Record<GateRuleId, string> = {
  'risk.p0': 'is-p0',
  'budget.exceeded': 'is-warn',
  'verify.repeat-fail': 'is-warn',
  'verify.base-fail': 'is-warn',
  'verify.flaky': 'is-warn',
  'forge-defect': 'is-info',
  'unit.boundary': 'is-info',
  'ready-for-review': 'is-ok',
  'run.interrupted': 'is-warn',
  'ci.red': 'is-warn',
  'refinery.conflict': 'is-warn',
}

async function readInbox(): Promise<InboxView> {
  return (await invoke('foundry:inbox.list')) as InboxView
}

/** @internal */
export const SIGNAL_POLL_MS = 4000

export function Inbox({
  onOpenOrder,
}: {
  onOpenOrder?: (orderId: string) => void
} = {}): JSX.Element | null {
  const [view, setView] = useState<InboxView | null>(null)
  const refreshList = useCallback(() => readInbox().then(setView), [])
  // An order can start waiting on you at any moment; Foundry says when.
  usePushed(readInbox, setView, { kinds: ANY_RECORD })
  const signals = useSignals()
  const answers = useAnswers(refreshList, signals.refreshSignals)

  if (view === null) return null

  const waiting = view.waiting ?? []
  const quiet =
    waiting.length === 0 &&
    view.gates.length === 0 &&
    signals.signals.length === 0 &&
    answers.problem === null &&
    signals.promoted === null
  if (quiet) return null

  return (
    <section className="fdry-inbox" aria-label="Waiting on you">
      {answers.problem !== null ? <p className="fdry-problem">{answers.problem}</p> : null}
      <WaitingOrders waiting={waiting} onOpenOrder={onOpenOrder} />
      <GateQueue gates={view.gates} busy={answers.busy} onAnswer={answers.answer} />
      <SignalsSection signals={signals} />
    </section>
  )
}

/** Answering a gate: which one is being sent, and what the last refusal said. */
function useAnswers(refreshList: () => Promise<void>, refreshSignals: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
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
        await refreshList()
        await refreshSignals()
      } finally {
        setBusy(null)
      }
    },
    [refreshList, refreshSignals]
  )
  return { busy, problem, answer }
}

/** The sensors' signals, and promoting one into a draft. */
function useSignals() {
  const { signals, sensors, refreshSignals } = useSignalFeed(SIGNAL_POLL_MS)
  const promotion = usePromotion(sensors, refreshSignals)
  const dismissSignal = useCallback(
    async (id: string) => {
      await invoke('foundry:signals.dismiss', { id })
      await refreshSignals()
    },
    [refreshSignals]
  )
  return { signals, sensors, refreshSignals, dismissSignal, ...promotion }
}

type Signals = ReturnType<typeof useSignals>

function WaitingOrders({
  waiting,
  onOpenOrder,
}: {
  readonly waiting: NonNullable<InboxView['waiting']>
  readonly onOpenOrder?: (orderId: string) => void
}) {
  if (waiting.length === 0) return null
  return (
    <ul className="fdry-queue" aria-label="Orders waiting on you">
      {waiting.map((row) => (
        <WaitingRow key={row.orderId} row={row} onOpen={() => onOpenOrder?.(row.orderId)} />
      ))}
    </ul>
  )
}

function WaitingRow({
  row,
  onOpen,
}: {
  readonly row: NonNullable<InboxView['waiting']>[number]
  readonly onOpen: () => void
}) {
  return (
    <li className="fdry-gate is-warn">
      <span className="fdry-gate-stripe" aria-hidden="true" />
      <div className="fdry-waiting">
        <span className="fdry-gate-icon" aria-hidden="true">
          <Hand />
        </span>
        <WaitingText row={row} />
        <div className="fdry-gate-actions">
          <Button
            variant="primary"
            size="sm"
            aria-label={`Open ${row.title} in the Forge`}
            onClick={onOpen}
          >
            Open
          </Button>
        </div>
      </div>
    </li>
  )
}

interface GateQueueProps {
  readonly gates: InboxView['gates']
  readonly busy: string | null
  readonly onAnswer: (gateId: string, option: string, limit?: number | null) => Promise<void>
}

function WaitingText({ row }: { readonly row: NonNullable<InboxView['waiting']>[number] }) {
  return (
    <div className="fdry-waiting-main">
      <b>{row.headline}</b>
      <span className="fdry-waiting-title">{row.title}</span>
      <p>{row.detail}</p>
    </div>
  )
}

function GateQueue({ gates, busy, onAnswer }: GateQueueProps) {
  if (gates.length === 0) return null
  return (
    <ul className="fdry-queue">
      {gates.map((gate) => (
        <li key={gate.id} className={`fdry-gate ${RULE_TONE[gate.rule]}`}>
          <span className="fdry-gate-stripe" aria-hidden="true" />
          <GateCard
            gate={gate}
            busy={busy === gate.id}
            pulls={gate.pulls}
            source={gate.source}
            onDecide={(option, limit) => void onAnswer(gate.id, option, limit)}
            lead={<GateLead rule={gate.rule} />}
            meta={
              <>
                <span>{gate.orderTitle ?? `work order ${gate.orderId}`}</span>
                {gate.blockedUnits > 0 ? <span>{gate.blockedUnits} units waiting</span> : null}
              </>
            }
          />
        </li>
      ))}
    </ul>
  )
}

/** What leads a gate's row here: the rule's icon and its name. */
function GateLead({ rule }: { readonly rule: GateRuleId }) {
  const Icon = RULE_ICON[rule]
  return (
    <>
      <span className="fdry-gate-icon" aria-hidden="true">
        <Icon />
      </span>
      <code className="fdry-gate-rule" title={ruleInWords(rule)}>
        {ruleInWords(rule)}
      </code>
    </>
  )
}

function SignalsSection({ signals: model }: { readonly signals: Signals }) {
  const { signals, signalProblem, promoted } = model
  if (signals.length === 0) return null
  return (
    <section className="fdry-signals" aria-label="From the factory's sensors">
      <h2 className="fdry-panel-h">From the factory&rsquo;s sensors</h2>
      {signalProblem !== null ? <p className="fdry-problem">{signalProblem}</p> : null}
      {promoted !== null ? <p className="fdry-note">{promoted}</p> : null}
      <ul className="fdry-signal-list">
        {signals.map((signal) => (
          <SignalItem key={signal.id} signal={signal} model={model} />
        ))}
      </ul>
    </section>
  )
}

function SignalItem({ signal, model }: { readonly signal: Signal; readonly model: Signals }) {
  const promoting = model.promoting === signal.id
  return (
    <li className="fdry-signal">
      <div className="fdry-signal-main">
        <b>{signal.title}</b>
        <SignalMeta signal={signal} sensors={model.sensors} />
        {promoting ? <PromoteForm signal={signal} model={model} /> : null}
      </div>
      {promoting ? null : (
        <div className="fdry-signal-actions">
          <Button variant="primary" size="sm" onClick={() => model.startPromote(signal)}>
            Promote
          </Button>
          <Button size="sm" onClick={() => void model.dismissSignal(signal.id)}>
            Dismiss
          </Button>
        </div>
      )}
    </li>
  )
}

function SignalMeta({
  signal,
  sensors,
}: {
  readonly signal: Signal
  readonly sensors: readonly SensorRow[]
}) {
  const sensor = sensors.find((s) => s.def.id === signal.sensorId)
  const evidence = latestEvidence(signal)
  return (
    <div className="fdry-signal-meta">
      <span>×{signal.occurrences}</span>
      <span>{signal.severity}</span>
      <span>{sensor?.def.description ?? signal.sensorId}</span>
      {evidence !== undefined ? (
        <ExternalLink href={evidence.url}>{evidence.title}</ExternalLink>
      ) : null}
    </div>
  )
}

function PromoteForm({ signal, model }: { readonly signal: Signal; readonly model: Signals }) {
  return (
    <div className="fdry-signal-promote">
      <label>
        Repository
        <input
          type="text"
          value={model.repoDraft}
          placeholder="/path/to/repo"
          onChange={(event) => model.setRepoDraft(event.target.value)}
        />
      </label>
      <Button
        variant="primary"
        size="sm"
        disabled={model.repoDraft.trim() === ''}
        onClick={() => void model.confirmPromote(signal.id)}
      >
        Confirm promote
      </Button>
      <Button size="sm" onClick={() => model.setPromoting(null)}>
        Cancel
      </Button>
    </div>
  )
}
