import { useState } from 'react'
import { Dialog, type DialogAction } from '@terminator/extension-ui'
import { IssuePicker } from '../integrations/IssuePicker'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useModalEffect } from '../../stores/modal.store'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { IssueSummary } from '../../../shared/types/index'

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

  const actions: DialogAction[] = [
    ...(own ? [{ label: 'Remove session link', disabled: busy, onSelect: () => write(null) }] : []),
    { label: 'Cancel', onSelect: onClose },
    {
      label: selected === null ? 'Link issue' : `Link ${selected.key}`,
      tone: 'primary',
      disabled: selected === null || busy,
      onSelect: () =>
        selected ? write({ tracker: selected.tracker, key: selected.key }) : undefined,
    },
  ]

  // The dialog renders inside a row or tile; its keys stay its own. Escape still
  // reaches the document, where the dialog (and the picker's dropdown) answer it.
  return (
    <div
      style={{ display: 'contents' }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') e.stopPropagation()
      }}
    >
      <Dialog title="Link a work item" onDismiss={onClose} actions={actions}>
        <p className="tmui-dialog__description">
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
          <p className="tmui-dialog__description" role="alert">
            No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.
          </p>
        )}

        {error !== null && (
          <p className="tmui-dialog__description" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  )
}
