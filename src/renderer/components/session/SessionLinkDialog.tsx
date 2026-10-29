import { type JSX, useState } from 'react'
import { Dialog, type DialogAction } from '@terminator/extension-ui'
import { IssuePicker } from '../integrations/IssuePicker'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
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
  const connected = useIntegrationsStore((s) => s.isAnyConnected())
  const [selected, setSelected] = useState<IssueSummary | null>(null)
  const { busy, error, write } = useLinkWrite(facts, onClose)
  const own = facts.workItem?.source === 'session' ? facts.workItem.ref : null

  // The dialog renders inside a row or tile; its keys stay its own. Escape still
  // reaches the document, where the dialog (and the picker's dropdown) answer it.
  return (
    <div
      style={{ display: 'contents' }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') e.stopPropagation()
      }}
    >
      <Dialog
        title="Link a work item"
        onDismiss={onClose}
        actions={linkActions({ own: own !== null, selected, busy, write }, onClose)}
      >
        <p className="tmui-dialog__description">{linkScope(facts.name, own?.key)}</p>
        <PickerOrNotice connected={connected} selected={selected} onSelect={setSelected} />
        {error !== null && (
          <p className="tmui-dialog__description" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  )
}

/** That a link here is this session's alone, and what it replaces. */
function linkScope(name: string, ownKey: string | undefined): string {
  return ownKey
    ? `${name} is linked to ${ownKey}. A new link replaces it for this session only.`
    : `Linking ${name} to a ticket applies to this session only.`
}

type LinkRef = { tracker: IssueSummary['tracker']; key: string } | null

/** Writing the session's link, and saying so when it did not take. */
function useLinkWrite(facts: SessionFacts, onClose: () => void) {
  const setLink = useSessionRecordsStore((s) => s.setLink)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function write(ref: LinkRef): Promise<void> {
    setBusy(true)
    const ok = await setLink(facts.snapshot, ref)
    setBusy(false)
    if (!ok) {
      setError('Could not link that issue. Nothing was changed.')
      return
    }
    onClose()
  }
  return { busy, error, write }
}

interface LinkState {
  /** Whether the session has a link of its own to remove. */
  own: boolean
  selected: IssueSummary | null
  busy: boolean
  write: (ref: LinkRef) => Promise<void>
}

function linkActions(
  { own, selected, busy, write }: LinkState,
  onClose: () => void
): DialogAction[] {
  return [
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
}

interface PickerProps {
  connected: boolean
  selected: IssueSummary | null
  onSelect: (issue: IssueSummary | null) => void
}

/** The issue picker, or where to connect a tracker when none is. */
function PickerOrNotice({ connected, selected, onSelect }: PickerProps): JSX.Element {
  if (!connected) {
    return (
      <p className="tmui-dialog__description" role="alert">
        No issue tracker is connected. Connect Linear in Settings → Integrations.
      </p>
    )
  }
  return <IssuePicker selected={selected} onSelect={onSelect} onClear={() => onSelect(null)} />
}
