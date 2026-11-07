import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Kbd, Popover } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { Workspace } from '../../../shared/types/index'
import { GLOBAL_CHOICE, holdsText, type ChosenRepo } from './start-work-model'

export interface WorkspacePickerProps {
  current: Workspace | null
  /** True when Global is chosen: the work belongs to no workspace. */
  global: boolean
  /** Global is offered on the Prompt tab only. */
  offerGlobal: boolean
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

const Swatch = ({ color }: { color: string }): React.JSX.Element => (
  <span className="workspace-picker__swatch" style={{ background: color }} aria-hidden="true" />
)

/** The choice of no workspace, in place of a workspace's colour. */
const Ring = (): React.JSX.Element => (
  <span className="workspace-picker__swatch workspace-picker__ring" aria-hidden="true" />
)

const GLOBAL_NAME = 'Global'

/** Where the work goes: the workspace, shown at the end of the tab row, changed in a popover. */
export function WorkspacePicker(props: WorkspacePickerProps): React.JSX.Element {
  const { open, onClose } = props
  return (
    <div className="workspace-picker">
      <PickerButton {...props} />
      {open && (
        <Popover
          label="Choose a workspace"
          onDismiss={onClose}
          align="end"
          className="workspace-picker__popover"
        >
          <WorkspaceChoices {...props} />
        </Popover>
      )}
    </div>
  )
}

function PickerButton(props: WorkspacePickerProps): React.JSX.Element {
  const { current, global, open, onToggle } = props
  const name = global ? GLOBAL_NAME : (current?.name ?? 'none')
  return (
    <button
      type="button"
      tabIndex={-1}
      className="workspace-picker__button"
      aria-label={`Workspace: ${name}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="workspace-picker__label">Workspace</span>
      {global ? <Ring /> : current !== null && <Swatch color={current.color} />}
      <span>{name}</span>
      <ChevronDown aria-hidden="true" />
      <Kbd>⌘R</Kbd>
    </button>
  )
}

interface ChoiceKeys {
  /** The ids listed, top to bottom: GLOBAL_CHOICE first when Global is shown. */
  ids: string[]
  at: number
  setCursor: (index: number) => void
  onPick: (id: string) => void
}

/** Arrow keys and Enter; Escape is left to the popover, and the launcher behind must not also act. */
function choiceKeyHandler({ ids, at, setCursor, onPick }: ChoiceKeys) {
  return (e: React.KeyboardEvent): void => {
    const moves: Record<string, () => void> = {
      ArrowDown: () => setCursor(Math.min(at + 1, ids.length - 1)),
      ArrowUp: () => setCursor(Math.max(at - 1, 0)),
      Enter: () => ids[at] !== undefined && onPick(ids[at]),
    }
    const run = moves[e.key]
    if (run === undefined) return
    e.preventDefault()
    e.stopPropagation()
    run()
  }
}

function WorkspaceChoices(props: WorkspacePickerProps): React.JSX.Element {
  const { onPick } = props
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const [filter, setFilter] = useState('')
  const [cursor, setCursor] = useState(0)
  const matches = holdsText(filter)
  const shown = workspaces.filter((w) => matches(w.name))
  const showGlobal = props.offerGlobal && matches(GLOBAL_NAME)
  const ids = [...(showGlobal ? [GLOBAL_CHOICE] : []), ...shown.map((w) => w.id)]
  const at = Math.min(cursor, ids.length - 1)
  return (
    <div onKeyDown={choiceKeyHandler({ ids, at, setCursor, onPick })}>
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
      <WorkspaceList {...props} shown={shown} showGlobal={showGlobal} at={at} />
    </div>
  )
}

type WorkspaceListProps = WorkspacePickerProps & {
  shown: Workspace[]
  showGlobal: boolean
  at: number
}

function WorkspaceList(props: WorkspaceListProps) {
  const { shown, showGlobal, at, current, reason, ticketKey, onPick } = props
  const note = suggestionNote({ reason, ticketKey })
  const first = showGlobal ? 1 : 0
  return (
    <div role="listbox" aria-label="Workspace" className="workspace-picker__list">
      {showGlobal && <GlobalItem active={at === 0} selected={props.global} onPick={onPick} />}
      {shown.map((w, i) => (
        <WorkspaceItem
          key={w.id}
          {...{ workspace: w, onPick }}
          active={i + first === at}
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

type GlobalItemProps = Pick<WorkspaceItemProps, 'active' | 'selected' | 'onPick'>

function GlobalItem({ active, selected, onPick }: GlobalItemProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-active={active}
      className="workspace-picker__item workspace-picker__global"
      onClick={() => onPick(GLOBAL_CHOICE)}
    >
      <Ring />
      <span className="workspace-picker__name">{GLOBAL_NAME}</span>
      <span className="workspace-picker__note">no workspace</span>
      <span className="workspace-picker__path">~ · shows in Scratch</span>
    </div>
  )
}
