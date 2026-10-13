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
export function WorkItemCell(props: Props): JSX.Element {
  const { workItem, issue, description, readOnly = false } = props
  const draft = useDescriptionDraft(description, props.onSaveDescription)

  if (workItem !== null) return <LinkedTicket ticketKey={workItem.ref.key} issue={issue} />
  if (description !== null && !draft.editing) {
    return (
      <DescriptionView
        description={description}
        onEdit={readOnly ? undefined : () => draft.start(description)}
      />
    )
  }
  if (readOnly) return <span className="work-item" />
  return <DescriptionEditor draft={draft} onLink={props.onLink} />
}

/** The ticket's key, then its title once read, or a note that it could not be. */
function LinkedTicket({ ticketKey, issue }: { ticketKey: string; issue: Props['issue'] }) {
  return (
    <span className="work-item">
      <span className="work-item__key">{ticketKey}</span>
      {issue === null ? (
        <span className="work-item__muted">Details unavailable</span>
      ) : issue !== undefined ? (
        <span className="work-item__title">{issue.title}</span>
      ) : null}
    </span>
  )
}

/** The description's first line, with an edit button unless it is history. */
function DescriptionView({ description, onEdit }: { description: string; onEdit?: () => void }) {
  return (
    <span className="work-item">
      <span className="work-item__description">{description.split('\n')[0]}</span>
      {onEdit && (
        <button
          type="button"
          className="work-item__icon-button"
          aria-label="Edit description"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Pencil aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/** The text being typed, and saving it (empty clears) or abandoning it. */
function useDescriptionDraft(description: string | null, save: Props['onSaveDescription']) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const finish = (): void => {
    setText('')
    setEditing(false)
  }
  return {
    editing,
    text,
    setText,
    start: (current: string): void => {
      setText(current)
      setEditing(true)
    },
    commit: (): void => {
      const trimmed = text.trim()
      if (trimmed === '' && description === null) return
      save(trimmed === '' ? null : trimmed)
      finish()
    },
    cancel: finish,
  }
}

interface EditorProps {
  draft: ReturnType<typeof useDescriptionDraft>
  onLink?: () => void
}

/** The description field (Enter saves, Escape abandons) and, where possible, Link. */
function DescriptionEditor({ draft, onLink }: EditorProps): JSX.Element {
  return (
    <span className="work-item work-item--editing" onClick={(e) => e.stopPropagation()}>
      <input
        className="work-item__input"
        aria-label={PROMPT}
        placeholder="What is it doing?"
        maxLength={DESCRIPTION_MAX_LENGTH}
        value={draft.text}
        autoFocus={draft.editing}
        onChange={(e) => draft.setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') draft.commit()
          if (e.key === 'Escape') draft.cancel()
        }}
      />
      {onLink !== undefined && <LinkButton onLink={onLink} />}
    </span>
  )
}

function LinkButton({ onLink }: { onLink: () => void }): JSX.Element {
  return (
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
  )
}
