import React, { useCallback, useEffect, useState } from 'react'
import { ScrollText, Sparkles, Check, X, Trash2 } from 'lucide-react'
import type { LedgerEntry } from '../ledger/append.js'
import type { Proposal } from '../ledger/curator.js'
import type { FactoryMetrics } from '../factory/metrics.js'
import { formatDuration } from '../factory/format.js'
import { Button, Markdown, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import { openInBrowser } from './ExternalLink.js'
import { usePushed, ANY_RECORD } from '../renderer/use-pushed.js'
import { MetricsTiles, WindowToggle } from './MetricsTiles.js'
import { rungLevelInWords } from '../verify/ladder.js'
import type { Rung } from '../verify/ladder.js'
import { rungInWords } from '../recipe/rung.js'
import type { Rung as ResolveRung } from '../recipe/rung.js'
import { invoke } from '@terminator/extension-sdk/renderer'

// The record: every decision, by whom or by what rule, and why.
//
// Read-only apart from one button. Proposals appear when the operator presses
// it and at no other time — a surface that volunteers rules is one whose rules
// get accepted without being read, and a rule accepted without being read is
// worse than no rule.

interface LedgerView {
  entries: LedgerEntry[]
  total: number
  actors: string[]
  actions: string[]
  orders: string[]
}

interface AcceptedRule {
  id: string
  asserts: string
  rung: string
  origin: string
}

interface AvailableSkill {
  id: string
  rung: string
}

interface RulesView {
  rules: AcceptedRule[]
  declined: { id: string; reason: string; asserts?: string | null }[]
  skills: AvailableSkill[]
}

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

async function readRules(): Promise<RulesView | null> {
  const next = (await invoke('foundry:rules.inForce', {})) as Partial<RulesView> & {
    error?: string
  }
  if (next.error !== undefined) return null
  // Normalised on arrival rather than guarded at every read: a reply missing
  // an array is the same thing to this panel as an empty one.
  return { rules: next.rules ?? [], declined: next.declined ?? [], skills: next.skills ?? [] }
}

async function readLedger(
  orderId: string,
  actor: string,
  action: string
): Promise<LedgerView | null> {
  const next = (await invoke('foundry:ledger.query', {
    orderId: orderId === '' ? undefined : orderId,
    actor: actor === '' ? undefined : actor,
    action: action === '' ? undefined : action,
    limit: PAGE,
  })) as LedgerView | { error: string }
  return 'error' in next ? null : next
}

async function readMetrics(window: '30d' | 'all'): Promise<FactoryMetrics | null> {
  const next = (await invoke('foundry:factory.metrics', { window })) as
    | FactoryMetrics
    | { error: string }
  return 'error' in next ? null : next
}

/** `operator`, `rule:budget.exceeded`, `role:verifier` — the kind, for the eye. */
function actorKind(actor: string): string {
  if (actor.startsWith('rule:')) return 'rule'
  if (actor.startsWith('role:')) return 'role'
  return 'operator'
}

type LedgerTab = 'record' | 'factory'

export function Ledger(): JSX.Element {
  const [tab, setTab] = useState<LedgerTab>('record')
  const [view, setView] = useState<LedgerView | null>(null)
  const [orderId, setOrderId] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [rules, setRules] = useState<RulesView | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [metricsWindow, setMetricsWindow] = useState<'30d' | 'all'>('30d')
  const [metrics, setMetrics] = useState<FactoryMetrics | null>(null)

  const refreshRules = useCallback(() => readRules().then(whenRead(setRules)), [])

  // The record grows while it is open; Foundry says when, and for which order.
  const readEntries = useCallback(
    () => readLedger(orderId, actor, action),
    [orderId, actor, action]
  )
  const showEntries = useCallback((next: LedgerView | null) => {
    if (next !== null) setView(next)
  }, [])
  usePushed(readEntries, showEntries, { kinds: ['ledger'] })

  useEffect(() => {
    void readRules().then(whenRead(setRules))
  }, [])

  // Fetched only once the operator asks for the Factory view — the same
  // discipline as the proposals panel: a surface that fetches before it is
  // looked at is a surface whose numbers go stale unnoticed.
  const readShownMetrics = useCallback(
    () => (tab === 'factory' ? readMetrics(metricsWindow) : Promise.resolve(null)),
    [tab, metricsWindow]
  )
  const showMetrics = useCallback((next: FactoryMetrics | null) => {
    if (next !== null) setMetrics(next)
  }, [])
  usePushed(readShownMetrics, showMetrics, { kinds: tab === 'factory' ? ANY_RECORD : [] })

  const ask = useCallback(async () => {
    const next = (await invoke('foundry:rules.propose', {})) as { proposals?: Proposal[] }
    setProposals(next.proposals ?? [])
    setNote(null)
  }, [])

  const decide = useCallback(
    async (proposal: Proposal, accept: boolean) => {
      const result = (await invoke('foundry:rules.decide', {
        proposalId: proposal.id,
        accept,
      })) as { error?: string; rule?: string }
      if (result.error !== undefined) {
        setNote(result.error)
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

  /**
   * Take an accepted check back out.
   *
   * The counterpart to accepting one. A rule the operator can add but never
   * remove is one they stop accepting at all, and the removal is recorded so
   * the same proposal is not offered back next week.
   */
  const remove = useCallback(
    async (rule: AcceptedRule) => {
      const result = (await invoke('foundry:rules.remove', { ruleId: rule.id })) as {
        error?: string
      }
      if (result.error !== undefined) {
        setNote(result.error)
        return
      }
      setNote(`"${rule.asserts}" is no longer in force, and will not be proposed again.`)
      await refreshRules()
    },
    [refreshRules]
  )

  if (view === null) return <div className="fdry-empty">Loading the record…</div>

  return (
    <div className="fdry-shell">
      <TabsRoot selectedId={tab} onSelect={setTab}>
        <TabList label="Record or Factory" className="fdry-ledger-tabs">
          <Tab id="record">Record</Tab>
          <Tab id="factory">Factory</Tab>
        </TabList>

        <TabPanel id="factory" className="fdry-ledger-panel">
          <FactoryView
            metrics={metrics}
            metricsWindow={metricsWindow}
            onWindow={setMetricsWindow}
          />
        </TabPanel>
        <TabPanel id="record" className="fdry-ledger-panel">
          <div className="fdry-ledger-bar">
            <label>
              Order
              <select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
                <option value="">every order</option>
                {view.orders.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Decided by
              <select value={actor} onChange={(event) => setActor(event.target.value)}>
                <option value="">anyone</option>
                {view.actors.map((who) => (
                  <option key={who} value={who}>
                    {who}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Action
              <select value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="">anything</option>
                {view.actions.map((what) => (
                  <option key={what} value={what}>
                    {what}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              size="sm"
              icon={Sparkles}
              className="fdry-propose"
              onClick={() => void ask()}
            >
              What do I keep rejecting?
            </Button>
          </div>

          {note !== null ? <p className="fdry-note">{note}</p> : null}

          {proposals !== null ? (
            <section className="fdry-panel">
              <h3 className="fdry-panel-h">Proposed rules</h3>
              {proposals.length === 0 ? (
                <p className="fdry-note">
                  Nothing yet. A rule is proposed once the same reason has turned work away three
                  times — twice is a coincidence.
                </p>
              ) : (
                proposals.map((proposal) => (
                  <article key={proposal.id} className="fdry-proposal">
                    <b>{proposal.asserts}</b>
                    <p className="fdry-note">
                      {proposal.occurrences} rejections · checked at{' '}
                      {rungLevelInWords(proposal.rung as Rung)}
                    </p>
                    <ul className="fdry-citations">
                      {proposal.citations.map((citation) => (
                        <li key={citation.ref}>
                          <code>{citation.subject}</code> {citation.at.slice(0, 10)} —{' '}
                          <Markdown
                            inline
                            fetchesNothing
                            className="fdry-md-inline"
                            onOpenLink={openInBrowser}
                          >
                            {citation.reason}
                          </Markdown>
                        </li>
                      ))}
                    </ul>
                    <div className="fdry-proposal-actions">
                      <Button
                        variant="primary"
                        size="sm"
                        icon={Check}
                        onClick={() => void decide(proposal, true)}
                      >
                        Accept
                      </Button>
                      <Button size="sm" icon={X} onClick={() => void decide(proposal, false)}>
                        Never propose this
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </section>
          ) : null}

          {(rules?.rules?.length ?? 0) > 0 || (rules?.declined?.length ?? 0) > 0 ? (
            <section className="fdry-panel">
              <h3 className="fdry-panel-h">Checks you accepted</h3>
              {rules?.rules?.length === 0 ? (
                <p className="fdry-note">None in force.</p>
              ) : (
                rules?.rules?.map((rule) => (
                  <article key={rule.id} className="fdry-proposal">
                    <b>{rule.asserts}</b>
                    <p className="fdry-note">
                      from {rungInWords(rule.rung as ResolveRung)} · origin {rule.origin}
                    </p>
                    <div className="fdry-proposal-actions">
                      <Button size="sm" icon={Trash2} onClick={() => void remove(rule)}>
                        Remove this check
                      </Button>
                    </div>
                  </article>
                ))
              )}
              {(rules?.declined?.length ?? 0) > 0 ? (
                <ul className="fdry-citations">
                  {rules?.declined?.map((entry) => (
                    <li key={entry.id}>
                      <Markdown
                        inline
                        fetchesNothing
                        className="fdry-md-inline"
                        onOpenLink={openInBrowser}
                      >
                        {declinedInWords(entry)}
                      </Markdown>{' '}
                      — turned down:{' '}
                      <Markdown
                        inline
                        fetchesNothing
                        className="fdry-md-inline"
                        onOpenLink={openInBrowser}
                      >
                        {entry.reason}
                      </Markdown>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {(rules?.skills?.length ?? 0) > 0 ? (
            <section className="fdry-panel">
              <h3 className="fdry-panel-h">Skills in force</h3>
              <ul className="fdry-citations">
                {rules?.skills?.map((skill) => (
                  <li key={skill.id}>
                    <code>{skill.id}</code> ({rungInWords(skill.rung as ResolveRung)})
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {view.entries.length === 0 ? (
            <div className="fdry-nothing">
              <ScrollText aria-hidden="true" />
              <p>Nothing recorded yet.</p>
            </div>
          ) : (
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
                  {view.entries.map((entry) => (
                    <tr key={`${entry.at}-${entry.subject}-${entry.action}`}>
                      <td>{entry.at.replace('T', ' ').slice(0, 19)}</td>
                      <td>
                        <span className={`fdry-actor is-${actorKind(entry.actor)}`}>
                          {entry.actor}
                        </span>
                      </td>
                      <td>
                        <code>{entry.action}</code>
                      </td>
                      <td>{entry.subject}</td>
                      <td>
                        <Markdown
                          inline
                          fetchesNothing
                          className="fdry-md-inline"
                          onOpenLink={openInBrowser}
                        >
                          {entry.reason}
                        </Markdown>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <footer className="fdry-queue-foot">
            <span>
              showing <b>{view.entries.length}</b> of <b>{view.total}</b>
            </span>
          </footer>
        </TabPanel>
      </TabsRoot>
    </div>
  )
}

interface FactoryViewProps {
  readonly metrics: FactoryMetrics | null
  readonly metricsWindow: '30d' | 'all'
  readonly onWindow: (value: '30d' | 'all') => void
}

/** The Factory tab: the 30-day tiles, and the per-order table they roll up. */
function FactoryView({ metrics, metricsWindow, onWindow }: FactoryViewProps): JSX.Element {
  if (metrics === null) return <div className="fdry-empty">Loading the factory’s numbers…</div>

  return (
    <div>
      <WindowToggle value={metricsWindow} onChange={onWindow} />
      <MetricsTiles metrics={metrics} />

      {metrics.orders.length === 0 ? (
        <p className="fdry-note">No orders in this window.</p>
      ) : (
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
              {metrics.orders.map((order) => (
                <tr key={order.orderId}>
                  <td>{order.title}</td>
                  <td>{order.shipped ? '✓' : '—'}</td>
                  <td>{order.leadTimeMs === null ? '—' : formatDuration(order.leadTimeMs)}</td>
                  <td>{formatDuration(order.yourTimeMs)}</td>
                  <td>{order.reworks}</td>
                  <td>{order.ciRounds}</td>
                  <td>{order.sessions}</td>
                  <td>{order.firstPass ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
