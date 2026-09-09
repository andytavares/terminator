import React, { useCallback, useEffect, useState } from 'react'
import { Plus, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react'
import { Forge } from './Forge.js'
import { Floor } from './Floor.js'
import { ConfirmButton } from './ConfirmButton.js'

// The way into the Forge: what orders exist, and a way to seed another.
//
// Deliberately thin. The list is a door, not a board — everything that needs a
// decision is meant to reach the operator through the inbox, not by being
// noticed on a screen they have to remember to visit.

interface Ticket {
  readonly tracker: string
  readonly key: string
  readonly title: string
  readonly status: string
}

interface OrderRow {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly risk: string
  readonly failures: number
  readonly source: { kind: string; tracker: string | null; key: string | null }
  /** Questions this order is waiting on an answer to. */
  readonly openQuestions?: number
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export interface OrdersProps {
  readonly repoRoot: string | null
}

export function Orders({ repoRoot }: OrdersProps): JSX.Element {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [idea, setIdea] = useState('')
  // An order starts from something you typed or from a ticket. The second was
  // built end to end — read the issue, refuse a duplicate, write back to it —
  // and had no way in: the only control here sent `kind: 'typed'`, so the half
  // of the description that says "or tracker issue" was unreachable.
  const [from, setFrom] = useState<'typed' | 'tracker'>('typed')
  const [term, setTerm] = useState('')
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [connected, setConnected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [started, setStarted] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const r = (await invoke('foundry:order.list')) as { orders?: OrderRow[] }
    setRows(r.orders ?? [])
  }, [])

  useEffect(() => {
    void refresh()
    // The counts on these rows go stale the moment a question is answered in
    // another window or a run raises one, and this list is where the tab's
    // badge sends you — so it refetches while it is on screen rather than
    // once, on mount.
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [refresh])

  // Your tickets, listed rather than remembered. Refreshed when the picker
  // opens and when you search, not on every keystroke.
  const loadTickets = useCallback(async (search: string) => {
    const r = (await invoke('foundry:issues.mine', { term: search })) as {
      connected?: { tracker: string; account: string }[]
      issues?: Ticket[]
      error?: string
    }
    if (r.error !== undefined) {
      setProblem(r.error)
      return
    }
    setConnected((r.connected ?? []).map((c) => c.tracker))
    setTickets(r.issues ?? [])
  }, [])

  useEffect(() => {
    if (from === 'tracker' && tickets === null) void loadTickets('')
  }, [from, tickets, loadTickets])

  const seedFromTicket = useCallback(
    async (ticket: Ticket) => {
      if (repoRoot === null) return
      setBusy(true)
      setProblem(null)
      try {
        const r = (await invoke('foundry:order.create', {
          source: { kind: 'tracker', tracker: ticket.tracker, key: ticket.key },
          repoPaths: [repoRoot],
        })) as { order?: OrderRow; existing?: { id: string }; error?: string }
        if (r.error !== undefined) {
          setProblem(r.error)
          return
        }
        await refresh()
        // An order already made from this ticket is an answer, not a failure.
        setOpen(r.order?.id ?? r.existing?.id ?? null)
      } finally {
        setBusy(false)
      }
    },
    [repoRoot, refresh]
  )

  const ready = idea.trim() !== ''

  const seed = useCallback(async () => {
    if (!ready || repoRoot === null) return
    setBusy(true)
    setProblem(null)
    try {
      const r = (await invoke('foundry:order.create', {
        source: { kind: 'typed', text: idea },
        repoPaths: [repoRoot],
      })) as { order?: OrderRow; existing?: { id: string }; error?: string }
      if (r.error !== undefined) {
        setProblem(r.error)
        return
      }
      setIdea('')
      await refresh()
      setOpen(r.order?.id ?? r.existing?.id ?? null)
    } finally {
      setBusy(false)
    }
  }, [idea, ready, repoRoot, refresh])

  if (open !== null) {
    const status = rows.find((row) => row.id === open)?.status
    // `started` is what the Forge reports the moment a run begins, so the
    // surface swaps without waiting for the list to be refetched.
    const running = status === 'running' || started === open
    return (
      <div className="fdry-shell">
        <button
          type="button"
          className="fdry-back"
          onClick={() => {
            setOpen(null)
            void refresh()
          }}
        >
          All orders
        </button>
        {/* Discard, because an order made by mistake had no way out: the
            `cancelled` status has been in the schema from the start and
            nothing ever set it, so the list only ever grew. Marked, not
            deleted — the records are the point. A running order is refused by
            the channel and says why. */}
        <div className="fdry-order-controls">
          {running ? null : (
            <button
              type="button"
              className="fdry-discard"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    const r = (await invoke('foundry:order.cancel', { id: open })) as {
                      error?: string
                    }
                    if (r.error !== undefined) {
                      setProblem(r.error)
                      return
                    }
                    setOpen(null)
                    await refresh()
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Discard this order
            </button>
          )}
          {/* The other answer, and the one `cancelled` never was: an order
              that is hidden still owns a worktree, a branch and a directory.
              Offered whatever the status, because a running order is exactly
              the one that has those things — its agents are stopped first. */}
          <ConfirmButton
            label="Delete this order"
            confirmLabel="Delete it and everything it made"
            warning={`This removes ${open} entirely — its records and ledger, its run graph and gates, its checkout and its branch. Nothing about it can be read back afterwards.`}
            disabled={busy}
            onConfirm={() => {
              void (async () => {
                setBusy(true)
                try {
                  const r = (await invoke('foundry:order.delete', { id: open })) as {
                    error?: string
                    failed?: string[]
                  }
                  // A partial teardown is said out loud rather than reported
                  // as success: a branch git would not delete is a branch
                  // still there, and the operator is the one who can act on it.
                  const trouble = r.error ?? (r.failed?.length ? r.failed.join('; ') : null)
                  if (trouble !== null) {
                    setProblem(trouble)
                    return
                  }
                  setOpen(null)
                  await refresh()
                } finally {
                  setBusy(false)
                }
              })()
            }}
          />
        </div>
        {/* An order that is running is watched on the Floor; one that is still
            being agreed is worked on in the Forge. */}
        {running ? (
          <Floor orderId={open} />
        ) : (
          <Forge
            orderId={open}
            onStarted={(id) => {
              setStarted(id)
              void refresh()
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="fdry-shell">
      <form
        className="fdry-seed"
        onSubmit={(event) => {
          event.preventDefault()
          void seed()
        }}
      >
        <div className="fdry-seed-from" role="group" aria-label="Start from">
          <button
            type="button"
            aria-pressed={from === 'typed'}
            disabled={busy || repoRoot === null}
            onClick={() => setFrom('typed')}
          >
            Idea
          </button>
          <button
            type="button"
            aria-pressed={from === 'tracker'}
            disabled={busy || repoRoot === null}
            onClick={() => setFrom('tracker')}
          >
            Ticket
          </button>
        </div>

        {from === 'typed' ? (
          <input
            aria-label="Describe what you want built or fixed"
            placeholder="Describe what you want built or fixed…"
            value={idea}
            disabled={busy || repoRoot === null}
            onChange={(event) => setIdea(event.target.value)}
          />
        ) : (
          <input
            aria-label="Search your tickets"
            placeholder="Search your tickets…"
            value={term}
            disabled={busy || repoRoot === null}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void loadTickets(term)
              }
            }}
          />
        )}
        {from === 'typed' ? (
          <button type="submit" disabled={busy || !ready || repoRoot === null}>
            <Plus aria-hidden="true" /> New order
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || repoRoot === null}
            onClick={() => void loadTickets(term)}
          >
            <Plus aria-hidden="true" /> Find
          </button>
        )}
      </form>
      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}

      {from === 'tracker' ? (
        connected !== null && connected.length === 0 ? (
          <p className="fdry-note">
            No tracker is connected. Connect Linear or Jira in the application&rsquo;s settings and
            your tickets will be listed here.
          </p>
        ) : tickets === null ? (
          <p className="fdry-note">Reading your tickets…</p>
        ) : tickets.length === 0 ? (
          <p className="fdry-note">No tickets matched. Try a different search.</p>
        ) : (
          <ul className="fdry-tickets">
            {tickets.map((ticket) => (
              <li key={`${ticket.tracker}-${ticket.key}`}>
                <button type="button" disabled={busy} onClick={() => void seedFromTicket(ticket)}>
                  <span className="fdry-ticket-key">{ticket.key}</span>
                  <span className="fdry-ticket-title">{ticket.title}</span>
                  {ticket.status === '' ? null : (
                    <span className="fdry-ticket-status">{ticket.status}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {rows.length === 0 ? (
        <p className="fdry-note">
          No orders yet. Describe something above, or give it a ticket, and Foundry will read the
          repository before it asks you anything.
        </p>
      ) : (
        <ul className="fdry-orders">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpen(row.id)}>
                <span className="fdry-order-mark" aria-hidden="true">
                  {(row.openQuestions ?? 0) > 0 ? (
                    <AlertCircle />
                  ) : row.failures === 0 ? (
                    <CheckCircle2 />
                  ) : (
                    <AlertTriangle />
                  )}
                </span>
                <span className="fdry-order-main">
                  <b>{row.title}</b>
                  <small>
                    {row.id} · {row.status} · risk {row.risk}
                    {row.source.key !== null ? ` · ${row.source.tracker} ${row.source.key}` : ''}
                  </small>
                </span>
                {/* Which order the tab badge is counting. Without this the
                    number on the chrome sends you to a list that will not say
                    where it came from. */}
                <span
                  className={`fdry-order-state${(row.openQuestions ?? 0) > 0 ? ' is-waiting' : ''}`}
                >
                  {(row.openQuestions ?? 0) > 0
                    ? `${row.openQuestions} waiting on you`
                    : row.failures === 0
                      ? 'ready to hand off'
                      : `blocked by ${row.failures}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
