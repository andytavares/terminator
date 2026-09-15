import React, { useState } from 'react'
import { IssuePicker } from '../integrations/IssuePicker'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useModalEffect } from '../../stores/modal.store'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { IssueSummary } from '../../../shared/types/index'
import '../sidebar/Dialog.css'

interface Props {
  facts: SessionFacts
  onClose: () => void
}

/**
 * Pinning a ticket to one session, over whatever its branch is linked to.
 *
 * The branch's own link is never touched here: removing the session's link
 * hands the session back to the branch's ticket (FR-012).
 */
export function SessionLinkDialog({ facts, onClose }: Props): JSX.Element {
  useModalEffect()
  const connected = useIntegrationsStore((s) => s.isAnyConnected())
  const setLink = useSessionRecordsStore((s) => s.setLink)
  const [selected, setSelected] = useState<IssueSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const own = facts.workItem?.source === 'session' ? facts.workItem.ref : null

  async function write(
    ref: { tracker: IssueSummary['tracker']; key: string } | null
  ): Promise<void> {
    setBusy(true)
    const ok = await setLink(facts.snapshot, ref)
    setBusy(false)
    if (!ok) {
      setError('Could not link that issue. Nothing was changed.')
      return
    }
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Link a work item"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h3 className="dialog__title">Link a work item</h3>
        <p className="dialog__description">
          {own
            ? `${facts.name} is linked to ${own.key}. A new link replaces it for this session only.`
            : `Linking ${facts.name} to a ticket applies to this session only.`}
        </p>

        {connected ? (
          <IssuePicker
            selected={selected}
            onSelect={setSelected}
            onClear={() => setSelected(null)}
          />
        ) : (
          <p className="dialog__description" role="alert">
            No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.
          </p>
        )}

        {error !== null && (
          <p className="dialog__description" role="alert">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          {own && (
            <button
              className="dialog__btn-secondary"
              disabled={busy}
              onClick={() => void write(null)}
            >
              Remove session link
            </button>
          )}
          <button className="dialog__btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="dialog__btn-primary"
            disabled={selected === null || busy}
            onClick={() => selected && void write({ tracker: selected.tracker, key: selected.key })}
          >
            {selected === null ? 'Link issue' : `Link ${selected.key}`}
          </button>
        </div>
      </div>
    </div>
  )
}
