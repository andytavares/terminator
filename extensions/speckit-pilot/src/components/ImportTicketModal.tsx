import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'
import type { Ticket } from '../types/speckit.types.js'

interface ImportTicketModalProps {
  repoRoot: string
  onClose: () => void
  onImported: (featureDir: string) => void
}

export function ImportTicketModal({ repoRoot, onClose, onImported }: ImportTicketModalProps) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await getSpeckitAPI().ticketList()
      setLoading(false)
      if ('tickets' in result) setTickets(result.tickets)
      else setError(result.error)
    })()
  }, [])

  async function importTicket(ticket: Ticket) {
    const result = await getSpeckitAPI().cardCreate({
      repoRoot,
      brief: { title: ticket.title, scope: ticket.body ?? '', source: ticket.source },
      ticket: {
        source: ticket.source,
        key: ticket.key,
        sourceUrl: ticket.sourceUrl,
        title: ticket.title,
      },
    })
    if ('featureDir' in result) onImported(result.featureDir)
    else setError(result.message ?? result.error)
  }

  return (
    <div className="sk-modal" role="dialog" aria-label="Import ticket">
      <div className="sk-modal__panel">
        <header className="sk-modal__head">
          <h2>Import a ticket</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {loading ? (
          <p>Loading tickets…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : tickets.length === 0 ? (
          <p>No assigned tickets found. Connect Linear or Jira in Settings.</p>
        ) : (
          <ul className="sk-import__list">
            {tickets.map((t) => (
              <li key={`${t.source}-${t.key}`}>
                <button type="button" onClick={() => void importTicket(t)}>
                  <span className={`sk-card-badge sk-card-badge--${t.source}`}>{t.source}</span>
                  <span className="sk-import__key">{t.key}</span>
                  <span className="sk-import__title">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
