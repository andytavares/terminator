import React, { useCallback, useEffect, useState } from 'react'
import { Plus, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Forge } from './Forge.js'
import { Floor } from './Floor.js'

// The way into the Forge: what orders exist, and a way to seed another.
//
// Deliberately thin. The list is a door, not a board — everything that needs a
// decision is meant to reach the operator through the inbox, not by being
// noticed on a screen they have to remember to visit.

interface OrderRow {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly risk: string
  readonly failures: number
  readonly source: { kind: string; tracker: string | null; key: string | null }
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
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const r = (await invoke('foundry:order.list')) as { orders?: OrderRow[] }
    setRows(r.orders ?? [])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const seed = useCallback(async () => {
    if (idea.trim() === '' || repoRoot === null) return
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
  }, [idea, repoRoot, refresh])

  if (open !== null) {
    const running = rows.find((row) => row.id === open)?.status === 'running'
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
        {/* An order that is running is watched on the Floor; one that is still
            being agreed is worked on in the Forge. */}
        {running ? <Floor orderId={open} /> : <Forge orderId={open} />}
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
        <input
          aria-label="Describe what you want built or fixed"
          placeholder="Describe what you want built or fixed…"
          value={idea}
          disabled={busy || repoRoot === null}
          onChange={(event) => setIdea(event.target.value)}
        />
        <button type="submit" disabled={busy || idea.trim() === '' || repoRoot === null}>
          <Plus aria-hidden="true" /> New order
        </button>
      </form>
      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}

      {rows.length === 0 ? (
        <p className="fdry-note">
          No orders yet. Describe something above and Foundry will read the repository before it
          asks you anything.
        </p>
      ) : (
        <ul className="fdry-orders">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpen(row.id)}>
                <span className="fdry-order-mark" aria-hidden="true">
                  {row.failures === 0 ? <CheckCircle2 /> : <AlertTriangle />}
                </span>
                <span className="fdry-order-main">
                  <b>{row.title}</b>
                  <small>
                    {row.id} · {row.status} · risk {row.risk}
                    {row.source.key !== null ? ` · ${row.source.tracker} ${row.source.key}` : ''}
                  </small>
                </span>
                <span className="fdry-order-state">
                  {row.failures === 0 ? 'ready to hand off' : `blocked by ${row.failures}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
