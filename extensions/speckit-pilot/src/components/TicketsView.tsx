import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { marked } from 'marked'
import type { Ticket } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'
import { DispatchSheet } from './DispatchSheet.js'

type FilterSource = 'all' | 'linear' | 'jira'

interface TicketsViewProps {
  workspacePath: string
}

function TicketBody({
  body,
  format,
}: {
  body: string | null | undefined
  format: 'markdown' | 'html' | undefined
}) {
  if (!body) return null
  const html = format === 'html' ? body : (marked.parse(body, { async: false }) as string)
  return (
    <div
      className="sk-ticket-body"
      // Content is from Linear/Jira APIs — trusted origin in local Electron context
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function TicketDetail({
  ticket,
  onRefresh,
  refreshing,
  workspacePath,
  onDispatched,
}: {
  ticket: Ticket
  onRefresh: () => void
  refreshing: boolean
  workspacePath: string
  onDispatched: () => void
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          background: 'var(--tm-bg-surface)',
        }}
      >
        <span className={`sk-source-badge sk-source-badge--${ticket.source}`}>{ticket.source}</span>
        <span
          style={{ fontSize: 12, color: 'var(--tm-text-muted)', fontFamily: 'var(--tm-font-mono)' }}
        >
          {ticket.key}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--tm-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ticket.title}
        </span>
        <button
          className="sk-icon-btn"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh ticket"
          title="Refresh ticket"
          style={{ flexShrink: 0 }}
        >
          <RefreshCw size={13} style={{ opacity: refreshing ? 0.4 : 1 }} />
        </button>
        <a
          href={ticket.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="sk-icon-btn"
          aria-label="Open in browser"
          title="Open in browser"
          style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}
        >
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {ticket.body ? (
          <TicketBody body={ticket.body} format={ticket.bodyFormat} />
        ) : (
          <p style={{ color: 'var(--tm-text-muted)', fontSize: 13 }}>No description.</p>
        )}

        {(ticket.acceptanceCriteria ?? []).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--tm-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              Acceptance criteria
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
              {(ticket.acceptanceCriteria ?? []).map((ac, i) => (
                <li
                  key={i}
                  style={{ fontSize: 13, color: 'var(--tm-text-primary)', marginBottom: 4 }}
                >
                  {ac}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dispatch accordion */}
        <div
          style={{
            marginTop: 20,
            borderTop: '1px solid var(--tm-border)',
            paddingTop: 12,
          }}
        >
          <button
            onClick={() => setDispatchOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--tm-text-secondary)',
              padding: 0,
            }}
          >
            {dispatchOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Start a run
          </button>
          {dispatchOpen && (
            <div style={{ marginTop: 12 }}>
              <DispatchSheet
                ticket={{
                  source: ticket.source,
                  key: ticket.key,
                  title: ticket.title,
                  sourceUrl: ticket.sourceUrl,
                }}
                workspacePath={workspacePath}
                onDispatched={onDispatched}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function TicketsView({ workspacePath }: TicketsViewProps) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [filter, setFilter] = useState<FilterSource>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const api = getSpeckitAPI()
      const [linear, jira] = await Promise.all([
        api.credentialsStatus({ source: 'linear' }),
        api.credentialsStatus({ source: 'jira' }),
      ])
      const eitherConnected =
        ('connected' in linear && linear.connected) || ('connected' in jira && jira.connected)
      if (!mountedRef.current) return
      setConnected(eitherConnected)

      if (eitherConnected) {
        const result = await api.ticketList()
        if (!mountedRef.current) return
        if ('error' in result) {
          setError(result.error)
        } else {
          setTickets(result.tickets)
        }
      }
    } catch (err) {
      if (mountedRef.current) setError(String(err))
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = filter === 'all' ? tickets : tickets.filter((t) => t.source === filter)
  const selectedTicket = selectedKey ? (tickets.find((t) => t.key === selectedKey) ?? null) : null

  if (loading) {
    return <div className="sk-loading">Loading…</div>
  }

  if (error) {
    return <div style={{ padding: 16, color: 'var(--tm-danger)', fontSize: 13 }}>{error}</div>
  }

  if (!connected) {
    return (
      <div className="sk-empty">
        <div className="sk-empty__title">No integrations connected</div>
        <div className="sk-empty__sub">Connect Linear or Jira in Settings to see your tickets.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Ticket list pane */}
      <div
        style={{
          flex: selectedTicket ? '0 0 280px' : 1,
          overflowY: 'auto',
          borderRight: selectedTicket ? '1px solid var(--tm-border)' : 'none',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Filter + refresh bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            borderBottom: '1px solid var(--tm-border)',
            flexShrink: 0,
          }}
        >
          {(['all', 'linear', 'jira'] as FilterSource[]).map((src) => (
            <button
              key={src}
              onClick={() => setFilter(src)}
              className={`sk-pill${filter === src ? ' sk-pill--active' : ''}`}
            >
              {src === 'all' ? 'All' : src}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            className="sk-icon-btn"
            onClick={() => void load(true)}
            disabled={refreshing}
            aria-label="Refresh ticket list"
            title="Refresh ticket list"
          >
            <RefreshCw size={13} style={{ opacity: refreshing ? 0.4 : 1 }} />
          </button>
        </div>

        {/* Ticket rows */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--tm-text-secondary)', fontSize: 13 }}>
              No tickets found.
            </div>
          ) : (
            filtered.map((ticket) => (
              <div
                key={`${ticket.source}-${ticket.key}`}
                onClick={() => setSelectedKey(ticket.key)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--tm-border)',
                  cursor: 'pointer',
                  background: selectedKey === ticket.key ? 'var(--tm-bg-elevated)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`sk-source-badge sk-source-badge--${ticket.source}`}>
                    {ticket.source}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{ticket.key}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: 'var(--tm-text-primary)' }}>
                  {ticket.title}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ticket detail pane */}
      {selectedTicket && (
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--tm-bg-surface)' }}>
          <TicketDetail
            ticket={selectedTicket}
            onRefresh={() => void load(true)}
            refreshing={refreshing}
            workspacePath={workspacePath}
            onDispatched={() => setSelectedKey(null)}
          />
        </div>
      )}
    </div>
  )
}
