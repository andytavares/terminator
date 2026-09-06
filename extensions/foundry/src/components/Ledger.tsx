import React, { useCallback, useEffect, useState } from 'react'
import { ScrollText, Sparkles, Check, X } from 'lucide-react'
import type { LedgerEntry } from '../ledger/append.js'
import type { Proposal } from '../ledger/curator.js'

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

const PAGE = 200

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

/** `operator`, `rule:budget.exceeded`, `role:verifier` — the kind, for the eye. */
function actorKind(actor: string): string {
  if (actor.startsWith('rule:')) return 'rule'
  if (actor.startsWith('role:')) return 'role'
  return 'operator'
}

export function Ledger(): JSX.Element {
  const [view, setView] = useState<LedgerView | null>(null)
  const [orderId, setOrderId] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = (await invoke('foundry:ledger.query', {
      orderId: orderId === '' ? undefined : orderId,
      actor: actor === '' ? undefined : actor,
      action: action === '' ? undefined : action,
      limit: PAGE,
    })) as LedgerView | { error: string }
    if ('error' in next) return
    setView(next)
  }, [orderId, actor, action])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const ask = useCallback(async () => {
    const next = (await invoke('foundry:rules.propose', {})) as { proposals?: Proposal[] }
    setProposals(next.proposals ?? [])
    setNote(null)
  }, [])

  const decide = useCallback(async (proposal: Proposal, accept: boolean) => {
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
        ? `${proposal.id} is in force from the next run.`
        : `${proposal.id} will not be offered again.`
    )
    setProposals((current) => current?.filter((p) => p.id !== proposal.id) ?? null)
  }, [])

  if (view === null) return <div className="fdry-empty">Loading the record…</div>

  return (
    <div className="fdry-shell">
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
        <button type="button" className="fdry-propose" onClick={() => void ask()}>
          <Sparkles aria-hidden="true" /> What do I keep rejecting?
        </button>
      </div>

      {note !== null ? <p className="fdry-note">{note}</p> : null}

      {proposals !== null ? (
        <section className="fdry-panel">
          <h3 className="fdry-panel-h">Proposed rules</h3>
          {proposals.length === 0 ? (
            <p className="fdry-note">
              Nothing yet. A rule is proposed once the same reason has turned work away three times
              — twice is a coincidence.
            </p>
          ) : (
            proposals.map((proposal) => (
              <article key={proposal.id} className="fdry-proposal">
                <b>{proposal.asserts}</b>
                <p className="fdry-note">
                  {proposal.occurrences} rejections · rung {proposal.rung}
                </p>
                <ul className="fdry-citations">
                  {proposal.citations.map((citation) => (
                    <li key={citation.ref}>
                      <code>{citation.subject}</code> {citation.at.slice(0, 10)} — {citation.reason}
                    </li>
                  ))}
                </ul>
                <div className="fdry-proposal-actions">
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => void decide(proposal, true)}
                  >
                    <Check aria-hidden="true" /> Accept
                  </button>
                  <button type="button" onClick={() => void decide(proposal, false)}>
                    <X aria-hidden="true" /> Never propose this
                  </button>
                </div>
              </article>
            ))
          )}
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
                    <span className={`fdry-actor is-${actorKind(entry.actor)}`}>{entry.actor}</span>
                  </td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>{entry.subject}</td>
                  <td>{entry.reason}</td>
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
    </div>
  )
}
