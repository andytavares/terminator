import React, { useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button, Drawer, IconButton } from '@terminator/extension-ui'
import { useFocusStore } from '../../home/focus-store'
import { FOCUS_LIMIT, localDateKey, type FocusItem } from '../../home/focus'
import { IssueDetails } from '../integrations/IssueDetails'
import { ERROR_TEXT, TRACKER_LABELS, useIssueSearch } from '../integrations/use-issue-search'
import { useIntegrationsStore } from '../../stores/integrations.store'
import type { IssueSummary, TrackerId } from '../../../shared/types/index'

// The Plan today band's middle column: the operator's own open tickets, or a
// search across everything the trackers hold. A row opens the ticket; its Add
// puts it in today's focus.

type Pick = Omit<FocusItem, 'doneByHand'>

function TicketPick(issue: IssueSummary): Pick {
  return {
    id: `${issue.tracker}:${issue.key}`,
    title: `${issue.key} ${issue.title}`,
    workKey: { tracker: issue.tracker, key: issue.key },
  }
}

/** The connected tracker's name beside the search box; with several, none is named. */
function useSoleTrackerLabel(): string | null {
  const connections = useIntegrationsStore((s) => s.connections)
  const connected = connections.filter((c) => c.connected)
  return connected.length === 1 ? TRACKER_LABELS[connected[0].tracker] : null
}

function TicketSearchBox(props: { term: string; onChange: (term: string) => void }): JSX.Element {
  const trackerLabel = useSoleTrackerLabel()
  return (
    <div className="plan__search">
      <Search aria-hidden="true" />
      <input
        value={props.term}
        placeholder="Search all tickets…"
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.term !== '' && (
        <IconButton icon={X} label="Clear search" size="sm" onClick={() => props.onChange('')} />
      )}
      {props.term === '' && trackerLabel !== null && (
        <span className="plan__search-tracker">{trackerLabel}</span>
      )}
    </div>
  )
}

interface TicketRowProps {
  issue: IssueSummary
  disabled: boolean
  onOpen: (ticket: { tracker: TrackerId; key: string; title: string }) => void
}

/** The row's own click opens the ticket; a click on a button inside it does not. */
function fromButton(event: React.MouseEvent | React.KeyboardEvent): boolean {
  return (event.target as HTMLElement).closest('button') !== null
}

function TicketAddButton({
  issue,
  disabled,
}: {
  issue: IssueSummary
  disabled: boolean
}): JSX.Element {
  const pickFocus = useFocusStore((s) => s.pickFocus)
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-label={`Add ${issue.key} ${issue.title} to today's focus`}
      onClick={() => pickFocus(TicketPick(issue))}
    >
      Add
    </Button>
  )
}

function TicketRow({ issue, disabled, onOpen }: TicketRowProps): JSX.Element {
  const open = (): void => onOpen({ tracker: issue.tracker, key: issue.key, title: issue.title })
  return (
    <div
      className="plan__ticket"
      role="button"
      tabIndex={0}
      onClick={(e) => !fromButton(e) && open()}
      onKeyDown={(e) => e.key === 'Enter' && !fromButton(e) && open()}
    >
      <span className="plan__ticket-key">{issue.key}</span>
      <span className="plan__ticket-text">
        <span className="plan__ticket-title">{issue.title}</span>
        <span
          className="plan__ticket-assignee"
          data-unassigned={issue.assignee === null ? '' : undefined}
        >
          {issue.assignee?.name ?? 'Unassigned'}
        </span>
      </span>
      <TicketAddButton issue={issue} disabled={disabled} />
    </div>
  )
}

interface OpenTicket {
  tracker: TrackerId
  key: string
  title: string
}

function TicketRows(props: {
  issues: readonly IssueSummary[]
  today: readonly FocusItem[]
  onOpen: (ticket: OpenTicket) => void
}): JSX.Element {
  const full = props.today.length >= FOCUS_LIMIT
  return (
    <>
      {props.issues.map((issue) => (
        <TicketRow
          key={`${issue.tracker}:${issue.key}`}
          issue={issue}
          disabled={full || props.today.some((item) => item.id === `${issue.tracker}:${issue.key}`)}
          onOpen={props.onOpen}
        />
      ))}
    </>
  )
}

function TicketList(props: {
  result: ReturnType<typeof useIssueSearch>['result']
  loading: boolean
  searching: boolean
  today: readonly FocusItem[]
  onOpen: (ticket: OpenTicket) => void
}): JSX.Element {
  const { result, loading, searching, today, onOpen } = props
  return (
    <>
      {result.failures.map((failure) => (
        <p className="plan__none" key={failure.tracker}>
          {`${TRACKER_LABELS[failure.tracker]}: ${ERROR_TEXT[failure.error] ?? failure.error}`}
        </p>
      ))}
      {loading && <p className="plan__none">Loading tickets…</p>}
      {!loading && result.issues.length === 0 && (
        <p className="plan__none">
          {searching ? 'No tickets match.' : 'No tickets assigned to you.'}
        </p>
      )}
      {!loading && <TicketRows issues={result.issues} today={today} onOpen={onOpen} />}
    </>
  )
}

/** The middle column of Plan today: the operator's tickets, searchable. */
export function TicketsColumn(): JSX.Element {
  const [term, setTerm] = useState('')
  const [openTicket, setOpenTicket] = useState<OpenTicket | null>(null)
  const { result, loading } = useIssueSearch(term, true, { limit: 50 })
  const today = useFocusStore((s) => s.days[localDateKey(Date.now())] ?? [])
  const close = (): void => setOpenTicket(null)
  return (
    <div className="plan__column">
      <h3 className="plan__title">
        {term.trim() !== '' ? 'TICKETS · SEARCH RESULTS' : 'TICKETS · MINE'}
      </h3>
      <TicketSearchBox term={term} onChange={setTerm} />
      <TicketList
        result={result}
        loading={loading}
        searching={term.trim() !== ''}
        today={today}
        onOpen={setOpenTicket}
      />
      {openTicket !== null && (
        <Drawer label={`${openTicket.key} ${openTicket.title}`} onDismiss={close}>
          <IssueDetails tracker={openTicket.tracker} issueKey={openTicket.key} onClose={close} />
        </Drawer>
      )}
    </div>
  )
}
