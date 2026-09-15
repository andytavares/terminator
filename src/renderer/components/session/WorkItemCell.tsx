import React, { useState } from 'react'
import { Link, Pencil } from 'lucide-react'
import type { WorkItem } from '../../sidebar/work-item'
import type { Issue } from '../../../shared/types/index'
import { DESCRIPTION_MAX_LENGTH } from '../../../shared/schemas/session-records.schema'
import './WorkItemCell.css'

interface Props {
  workItem: WorkItem | null
  /** undefined while loading, null when it could not be read. */
  issue: Issue | null | undefined
  description: string | null
  /** A closed session's context is history: shown, never edited. */
  readOnly?: boolean
  /** null clears the description. */
  onSaveDescription: (description: string | null) => void
  /** Present only where linking is possible. */
  onLink?: () => void
}

const PROMPT = 'What is this session doing?'

/**
 * What a session is for: its ticket, else the operator's description, else a
 * field asking for one. The ticket wins because it is the shared record; the
 * description stays visible in the Logbook's detail.
 */
export function WorkItemCell({
  workItem,
  issue,
  description,
  readOnly = false,
  onSaveDescription,
  onLink,
}: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (workItem !== null) {
    return (
      <span className="work-item">
        <span className="work-item__key">{workItem.ref.key}</span>
        {issue === null ? (
          <span className="work-item__muted">Details unavailable</span>
        ) : issue !== undefined ? (
          <span className="work-item__title">{issue.title}</span>
        ) : null}
      </span>
    )
  }

  if (description !== null && !editing) {
    return (
      <span className="work-item">
        <span className="work-item__description">{description.split('\n')[0]}</span>
        {!readOnly && (
          <button
            type="button"
            className="work-item__icon-button"
            aria-label="Edit description"
            onClick={(e) => {
              e.stopPropagation()
              setDraft(description)
              setEditing(true)
            }}
          >
            <Pencil aria-hidden="true" />
          </button>
        )}
      </span>
    )
  }

  if (readOnly) return <span className="work-item" />

  function commit(): void {
    const text = draft.trim()
    if (text === '' && description === null) return
    onSaveDescription(text === '' ? null : text)
    setEditing(false)
    setDraft('')
  }

  return (
    <span className="work-item work-item--editing" onClick={(e) => e.stopPropagation()}>
      <input
        className="work-item__input"
        aria-label={PROMPT}
        placeholder="What is it doing?"
        maxLength={DESCRIPTION_MAX_LENGTH}
        value={draft}
        autoFocus={editing}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft('')
            setEditing(false)
          }
        }}
      />
      {onLink !== undefined && (
        <button
          type="button"
          className="work-item__link"
          aria-label="Link a work item"
          onClick={(e) => {
            e.stopPropagation()
            onLink()
          }}
        >
          <Link aria-hidden="true" />
          Link
        </button>
      )}
    </span>
  )
}
