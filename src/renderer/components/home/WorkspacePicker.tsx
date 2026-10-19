import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Kbd, Popover } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { Workspace } from '../../../shared/types/index'
import type { ChosenRepo } from './start-work-model'

export interface WorkspacePickerProps {
  current: Workspace | null
  reason: ChosenRepo['reason']
  /** The key of the ticket the suggestion was made for, if any. */
  ticketKey: string | null
  open: boolean
  onToggle: () => void
  onPick: (id: string) => void
  onClose: () => void
}

/** Why the suggested workspace was suggested, in the person's words; nothing once they picked one. */
function suggestionNote({
  reason,
  ticketKey,
}: Pick<WorkspacePickerProps, 'reason' | 'ticketKey'>): string | null {
  if (reason === 'linked-ticket') return `${(ticketKey ?? '').split('-')[0]} ticket linked here`
  if (reason === 'active') return 'open in the sidebar'
  if (reason === 'first') return 'first workspace'
  return null
}

const Swatch = ({ color }: { color: string }): JSX.Element => (
  <span className="workspace-picker__swatch" style={{ background: color }} aria-hidden="true" />
)

/** Where the work goes: the workspace, shown at the end of the tab row, changed in a popover. */
export function WorkspacePicker(props: WorkspacePickerProps): JSX.Element {
  const { open, onClose } = props
  return (
    <div className="workspace-picker">
      <PickerButton {...props} />
      {open && (
        <Popover
          label="Choose a workspace"
          onDismiss={onClose}
          className="workspace-picker__popover"
        >
          <WorkspaceChoices {...props} />
        </Popover>
      )}
    </div>
  )
}

function PickerButton({ current, open, onToggle }: WorkspacePickerProps): JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="workspace-picker__button"
      aria-label={`Workspace: ${current?.name ?? 'none'}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="workspace-picker__label">Workspace</span>
      {current !== null && <Swatch color={current.color} />}
      <span>{current?.name ?? 'none'}</span>
      <ChevronDown aria-hidden="true" />
      <Kbd>⌘R</Kbd>
    </button>
  )
}

interface ChoiceKeys {
  shown: Workspace[]
  at: number
  setCursor: (index: number) => void
  onPick: (id: string) => void
}

/** Arrow keys and Enter; Escape is left to the popover, and the launcher behind must not also act. */
function choiceKeyHandler({ shown, at, setCursor, onPick }: ChoiceKeys) {
  return (e: React.KeyboardEvent): void => {
    const moves: Record<string, () => void> = {
      ArrowDown: () => setCursor(Math.min(at + 1, shown.length - 1)),
      ArrowUp: () => setCursor(Math.max(at - 1, 0)),
      Enter: () => shown[at] !== undefined && onPick(shown[at].id),
    }
    const run = moves[e.key]
    if (run === undefined) return
    e.preventDefault()
    e.stopPropagation()
    run()
  }
}

function WorkspaceChoices(props: WorkspacePickerProps): JSX.Element {
  const { onPick } = props
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const [filter, setFilter] = useState('')
  const [cursor, setCursor] = useState(0)
  const shown = workspaces.filter((w) => w.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const at = Math.min(cursor, shown.length - 1)
  return (
    <div onKeyDown={choiceKeyHandler({ shown, at, setCursor, onPick })}>
      <input
        autoFocus
        className="workspace-picker__filter"
        value={filter}
        placeholder="Filter workspaces"
        aria-label="Filter workspaces"
        onChange={(e) => {
          setFilter(e.target.value)
          setCursor(0)
        }}
      />
      <WorkspaceList {...props} shown={shown} at={at} />
    </div>
  )
}

type WorkspaceListProps = WorkspacePickerProps & { shown: Workspace[]; at: number }

function WorkspaceList({ shown, at, current, reason, ticketKey, onPick }: WorkspaceListProps) {
  const note = suggestionNote({ reason, ticketKey })
  return (
    <div role="listbox" aria-label="Workspace" className="workspace-picker__list">
      {shown.map((w, i) => (
        <WorkspaceItem
          key={w.id}
          {...{ workspace: w, onPick }}
          active={i === at}
          note={w.id === current?.id ? note : null}
          selected={w.id === current?.id}
        />
      ))}
    </div>
  )
}

interface WorkspaceItemProps {
  workspace: Workspace
  active: boolean
  selected: boolean
  note: string | null
  onPick: (id: string) => void
}

function WorkspaceItem({ workspace, active, selected, note, onPick }: WorkspaceItemProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-active={active}
      className="workspace-picker__item"
      onClick={() => onPick(workspace.id)}
    >
      <Swatch color={workspace.color} />
      <span className="workspace-picker__name">{workspace.name}</span>
      {note !== null && <span className="workspace-picker__note">suggested · {note}</span>}
      <span className="workspace-picker__path">{workspace.folderPath}</span>
    </div>
  )
}
