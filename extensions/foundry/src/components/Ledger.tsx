import React, { useCallback, useEffect, useState } from 'react'
import { RecordShown } from '../renderer/RecordShown.js'
import { ScrollText, Sparkles, Check, X, Trash2 } from 'lucide-react'
import type { LedgerEntry } from '../ledger/append.js'
import type { Proposal } from '../ledger/curator.js'
import type { FactoryMetrics } from '../factory/metrics.js'
import { formatDuration } from '../factory/format.js'
import { Button, Markdown, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import { useFoundryQuery, ANY_RECORD } from '../renderer/foundry-query.js'
import { MetricsTiles, WindowToggle } from './MetricsTiles.js'
import { rungLevelInWords } from '../verify/ladder.js'
import type { Rung } from '../verify/ladder.js'
import { rungInWords } from '../recipe/rung.js'
import type { Rung as ResolveRung } from '../recipe/rung.js'
import { foundryInvoke } from '../renderer/foundry-invoke.js'
import type { FoundryApi } from '../ipc/foundry-api.js'

// The record: every decision, by whom or by what rule, and why.
//
// Read-only apart from one button. Proposals appear when the operator presses
// it and at no other time — a surface that volunteers rules is one whose rules
// get accepted without being read, and a rule accepted without being read is
// worse than no rule.

type LedgerView = FoundryApi['foundry:ledger.query']['answer']

type RulesView = FoundryApi['foundry:rules.inForce']['answer']

type AcceptedRule = RulesView['rules'][number]

const PAGE = 200

/** Records from before the assertion was kept have only an id, a slug of the operator's words. */
function declinedInWords(entry: { id: string; asserts?: string | null }): string {
  if (entry.asserts) return entry.asserts
  const words = entry.id.replace(/^curator-/, '').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A reply that was an error is `null`, and leaves what is on screen as it was. */
function whenRead<T>(show: (value: T) => void): (value: T | null) => void {
  return (value) => {
    if (value !== null) show(value)
  }
}

// Normalised on arrival rather than guarded at every read: a reply missing an array is the
// same thing to this panel as an empty one.
async function readRulesView(): Promise<RulesView> {
  const next = await foundryInvoke('foundry:rules.inForce')
  return { rules: next.rules ?? [], declined: next.declined ?? [], skills: next.skills ?? [] }
}

function readLedger(orderId: string, actor: string, action: string): Promise<LedgerView> {
  return foundryInvoke('foundry:ledger.query', {
    orderId: orderId === '' ? undefined : orderId,
    actor: actor === '' ? undefined : actor,
    action: action === '' ? undefined : action,
    limit: PAGE,
  })
}

/** `operator`, `rule:budget.exceeded`, `role:verifier` — the kind, for the eye. */
function actorKind(actor: string): string {
  if (actor.startsWith('rule:')) return 'rule'
  if (actor.startsWith('role:')) return 'role'
  return 'operator'
}

type LedgerTab = 'record' | 'factory'

export function Ledger(): React.JSX.Element {
  const [tab, setTab] = useState<LedgerTab>('record')
  const entries = useLedgerEntries()
  const { rules, refreshRules } = useRules()
  const factory = useFactoryMetrics(tab)
  const proposals = useProposals(refreshRules)

  if (entries.view === null) return <div className="fdry-empty">Loading the record…</div>

  return (
    <div className="fdry-shell">
      <RecordShown feature="ledger" />
      <TabsRoot selectedId={tab} onSelect={setTab}>
        <TabList label="Record or Factory" className="fdry-ledger-tabs">
          <Tab id="record">Record</Tab>
          <Tab id="factory">Factory</Tab>
        </TabList>

        <TabPanel id="factory" className="fdry-ledger-panel">
          <FactoryView {...factory} />
        </TabPanel>
        <TabPanel id="record" className="fdry-ledger-panel">
          <RecordTab
            entries={entries}
            view={entries.view}
            rules={rules ?? NO_RULES}
            proposals={proposals}
          />
        </TabPanel>
      </TabsRoot>
    </div>
  )
}

const NO_RULES: RulesView = { rules: [], declined: [], skills: [] }

interface RecordTabProps {
  readonly entries: ReturnType<typeof useLedgerEntries>
  readonly view: LedgerView
  readonly rules: RulesView
  readonly proposals: ReturnType<typeof useProposals>
}

/** The Record tab: the filters, the rules asked about and in force, and the entries. */
function RecordTab({ entries, view, rules, proposals }: RecordTabProps) {
  return (
    <>
      <LedgerFilters entries={entries} view={view} onAsk={() => void proposals.ask()} />
      {proposals.note !== null ? <p className="fdry-note">{proposals.note}</p> : null}
      <ProposalsPanel proposals={proposals.proposals} onDecide={proposals.decide} />
      <AcceptedPanel rules={rules} onRemove={proposals.remove} />
      <SkillsPanel rules={rules} />
      <EntriesTable entries={view.entries} />
      <footer className="fdry-queue-foot">
        <span>
          showing <b>{view.entries.length}</b> of <b>{view.total}</b>
        </span>
      </footer>
    </>
  )
}

/** The record as filtered, kept current: Foundry says when it grows, and for which order. */
function useLedgerEntries() {
  const [orderId, setOrderId] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const { data } = useFoundryQuery(
    { key: ['ledger', orderId, actor, action], kinds: ['ledger'] },
    () => readLedger(orderId, actor, action)
  )
  return { view: data ?? null, orderId, setOrderId, actor, setActor, action, setAction }
}

function useRules() {
  const [rules, setRules] = useState<RulesView | null>(null)
  const refreshRules = useCallback(() => readRulesView().then(whenRead(setRules)), [])
  useEffect(() => {
    void readRulesView().then(whenRead(setRules))
  }, [])
  return { rules, refreshRules }
}

// The factory's numbers, fetched only once the Factory view is asked for: a surface
// that fetches before it is looked at goes stale unnoticed.
function useFactoryMetrics(tab: LedgerTab): FactoryViewProps {
  const [metricsWindow, setMetricsWindow] = useState<'30d' | 'all'>('30d')
  const { data } = useFoundryQuery(
    { key: ['metrics', tab, metricsWindow], kinds: tab === 'factory' ? ANY_RECORD : [] },
    () =>
      tab === 'factory'
        ? foundryInvoke('foundry:factory.metrics', { window: metricsWindow })
        : Promise.resolve(null)
  )
  return { metrics: data ?? null, metricsWindow, onWindow: setMetricsWindow }
}

/** Proposed rules, asked for by the operator, and what accepting, declining or removing one said. */
function useProposals(refreshRules: () => Promise<void>) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const ask = useCallback(async () => {
    const next = await foundryInvoke('foundry:rules.propose', {})
    setProposals(next.proposals ?? [])
    setNote(null)
  }, [])
  const decide = useCallback(
    async (proposal: Proposal, accept: boolean) => {
      const error = await sendProposalDecision(proposal, accept)
      if (error !== null) {
        setNote(error)
        return
      }
      setNote(
        accept
          ? `"${proposal.asserts}" is in force from the next run.`
          : `"${proposal.asserts}" will not be offered again.`
      )
      setProposals((current) => current?.filter((p) => p.id !== proposal.id) ?? null)
      void refreshRules()
    },
    [refreshRules]
  )
  const remove = useRemoveRule(setNote, refreshRules)
  return { proposals, note, ask, decide, remove }
}

/** Accepts or declines a proposal; the refusal, or null when it took. */
async function sendProposalDecision(proposal: Proposal, accept: boolean): Promise<string | null> {
  const result = await foundryInvoke('foundry:rules.decide', {
    proposalId: proposal.id,
    accept,
  })
  return result.error ?? null
}

// Take an accepted check back out. A rule that cannot be removed is one the operator
// stops accepting; the removal is recorded so the proposal is not offered back.
function useRemoveRule(setNote: (note: string | null) => void, refreshRules: () => Promise<void>) {
  return useCallback(
    async (rule: AcceptedRule) => {
      const result = await foundryInvoke('foundry:rules.remove', { ruleId: rule.id })
      if (result.error !== undefined) {
        setNote(result.error)
        return
      }
      setNote(`"${rule.asserts}" is no longer in force, and will not be proposed again.`)
      await refreshRules()
    },
    [setNote, refreshRules]
  )
}

interface LedgerFiltersProps {
  readonly entries: ReturnType<typeof useLedgerEntries>
  readonly view: LedgerView
  readonly onAsk: () => void
}

function LedgerFilters({ entries, view, onAsk }: LedgerFiltersProps) {
  return (
    <div className="fdry-ledger-bar">
      <FilterSelect
        label="Order"
        value={entries.orderId}
        onChange={entries.setOrderId}
        any="every order"
        options={view.orders}
      />
      <FilterSelect
        label="Decided by"
        value={entries.actor}
        onChange={entries.setActor}
        any="anyone"
        options={view.actors}
      />
      <FilterSelect
        label="Action"
        value={entries.action}
        onChange={entries.setAction}
        any="anything"
        options={view.actions}
      />
      <Button variant="ghost" size="sm" icon={Sparkles} className="fdry-propose" onClick={onAsk}>
        What do I keep rejecting?
      </Button>
    </div>
  )
}

interface FilterSelectProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** What the empty choice, which filters nothing out, is called. */
  readonly any: string
  readonly options: readonly string[]
}

function FilterSelect({ label, value, onChange, any, options }: FilterSelectProps) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{any}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Markdown inline, opening any link in the browser and fetching nothing. */
function InlineMarkdown({ children }: { readonly children: string }) {
  return (
    <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
      {children}
    </Markdown>
  )
}

function ProposalsPanel({
  proposals,
  onDecide,
}: {
  readonly proposals: Proposal[] | null
  readonly onDecide: (proposal: Proposal, accept: boolean) => Promise<void>
}) {
  if (proposals === null) return null
  return (
    <section className="fdry-panel">
      <h3 className="fdry-panel-h">Proposed rules</h3>
      {proposals.length === 0 ? (
        <p className="fdry-note">
          Nothing yet. A rule is proposed once the same reason has turned work away three times —
          twice is a coincidence.
        </p>
      ) : (
        proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onDecide={onDecide} />
        ))
      )}
    </section>
  )
}

function ProposalCard({
  proposal,
  onDecide,
}: {
  readonly proposal: Proposal
  readonly onDecide: (proposal: Proposal, accept: boolean) => Promise<void>
}) {
  return (
    <article className="fdry-proposal">
      <b>{proposal.asserts}</b>
      <p className="fdry-note">
        {proposal.occurrences} rejections · checked at {rungLevelInWords(proposal.rung as Rung)}
      </p>
      <Citations citations={proposal.citations} />
      <div className="fdry-proposal-actions">
        <Button
          variant="primary"
          size="sm"
          icon={Check}
          onClick={() => void onDecide(proposal, true)}
        >
          Accept
        </Button>
        <Button size="sm" icon={X} onClick={() => void onDecide(proposal, false)}>
          Never propose this
        </Button>
      </div>
    </article>
  )
}

/** Each rejection a proposal stands on: what it was about, when, and why. */
function Citations({ citations }: { readonly citations: Proposal['citations'] }) {
  return (
    <ul className="fdry-citations">
      {citations.map((citation) => (
        <li key={citation.ref}>
          <code>{citation.subject}</code> {citation.at.slice(0, 10)} —{' '}
          <InlineMarkdown>{citation.reason}</InlineMarkdown>
        </li>
      ))}
    </ul>
  )
}

function AcceptedPanel({
  rules,
  onRemove,
}: {
  readonly rules: RulesView
  readonly onRemove: (rule: AcceptedRule) => Promise<void>
}) {
  if (rules.rules.length === 0 && rules.declined.length === 0) return null
  return (
    <section className="fdry-panel">
      <h3 className="fdry-panel-h">Checks you accepted</h3>
      {rules.rules.length === 0 ? (
        <p className="fdry-note">None in force.</p>
      ) : (
        rules.rules.map((rule) => (
          <AcceptedRuleCard key={rule.id} rule={rule} onRemove={onRemove} />
        ))
      )}
      <DeclinedList declined={rules.declined} />
    </section>
  )
}

function AcceptedRuleCard({
  rule,
  onRemove,
}: {
  readonly rule: AcceptedRule
  readonly onRemove: (rule: AcceptedRule) => Promise<void>
}) {
  return (
    <article className="fdry-proposal">
      <b>{rule.asserts}</b>
      <p className="fdry-note">
        from {rungInWords(rule.rung as ResolveRung)} · origin {rule.origin}
      </p>
      <div className="fdry-proposal-actions">
        <Button size="sm" icon={Trash2} onClick={() => void onRemove(rule)}>
          Remove this check
        </Button>
      </div>
    </article>
  )
}

function DeclinedList({ declined }: { readonly declined: RulesView['declined'] }) {
  if (declined.length === 0) return null
  return (
    <ul className="fdry-citations">
      {declined.map((entry) => (
        <li key={entry.id}>
          <InlineMarkdown>{declinedInWords(entry)}</InlineMarkdown> — turned down:{' '}
          <InlineMarkdown>{entry.reason}</InlineMarkdown>
        </li>
      ))}
    </ul>
  )
}

function SkillsPanel({ rules }: { readonly rules: RulesView }) {
  if (rules.skills.length === 0) return null
  return (
    <section className="fdry-panel">
      <h3 className="fdry-panel-h">Skills in force</h3>
      <ul className="fdry-citations">
        {rules.skills.map((skill) => (
          <li key={skill.id}>
            <code>{skill.id}</code> ({rungInWords(skill.rung as ResolveRung)})
          </li>
        ))}
      </ul>
    </section>
  )
}

function EntriesTable({ entries }: { readonly entries: readonly LedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="fdry-nothing">
        <ScrollText aria-hidden="true" />
        <p>Nothing recorded yet.</p>
      </div>
    )
  }
  return (
    <div className="fdry-scroll">
      <table className="fdry-ledger">
        <thead>
          <tr>
            <th>When</th>
            <th>Decided by</th>
            <th>Action</th>
            <th>About</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <EntryRow key={`${entry.at}-${entry.subject}-${entry.action}`} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EntryRow({ entry }: { readonly entry: LedgerEntry }) {
  return (
    <tr>
      <td>{entry.at.replace('T', ' ').slice(0, 19)}</td>
      <td>
        <span className={`fdry-actor is-${actorKind(entry.actor)}`}>{entry.actor}</span>
      </td>
      <td>
        <code>{entry.action}</code>
      </td>
      <td>{entry.subject}</td>
      <td>
        <InlineMarkdown>{entry.reason}</InlineMarkdown>
      </td>
    </tr>
  )
}

interface FactoryViewProps {
  readonly metrics: FactoryMetrics | null
  readonly metricsWindow: '30d' | 'all'
  readonly onWindow: (value: '30d' | 'all') => void
}

/** The Factory tab: the 30-day tiles, and the per-order table they roll up. */
function FactoryView({ metrics, metricsWindow, onWindow }: FactoryViewProps): React.JSX.Element {
  if (metrics === null) return <div className="fdry-empty">Loading the factory’s numbers…</div>

  return (
    <div>
      <WindowToggle value={metricsWindow} onChange={onWindow} />
      <MetricsTiles metrics={metrics} />
      {metrics.orders.length === 0 ? (
        <p className="fdry-note">No orders in this window.</p>
      ) : (
        <OrderMetricsTable orders={metrics.orders} />
      )}
    </div>
  )
}

function OrderMetricsTable({ orders }: { readonly orders: FactoryMetrics['orders'] }) {
  return (
    <div className="fdry-scroll">
      <table className="fdry-ledger">
        <thead>
          <tr>
            <th>Order</th>
            <th>Shipped</th>
            <th>Lead time</th>
            <th>Your time</th>
            <th>Reworks</th>
            <th>CI rounds</th>
            <th>Sessions</th>
            <th>First pass</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderMetricsRow key={order.orderId} order={order} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrderMetricsRow({ order }: { readonly order: FactoryMetrics['orders'][number] }) {
  return (
    <tr>
      <td>{order.title}</td>
      <td>{order.shipped ? '✓' : '—'}</td>
      <td>{order.leadTimeMs === null ? '—' : formatDuration(order.leadTimeMs)}</td>
      <td>{formatDuration(order.yourTimeMs)}</td>
      <td>{order.reworks}</td>
      <td>{order.ciRounds}</td>
      <td>{order.sessions}</td>
      <td>{order.firstPass ? '✓' : '—'}</td>
    </tr>
  )
}
