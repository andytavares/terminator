import React, { useState } from 'react'
import { Button, Dialog, IconButton } from '@terminator/extension-ui'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { KanbanLane, TaskStatus } from '../vault/types'

interface KanbanLaneEditorProps {
  lanes: KanbanLane[]
  onSave: (lanes: KanbanLane[]) => void
  onClose: () => void
}

type LaneDraft = ReturnType<typeof useLaneDraft>

interface RowProps {
  lanes: LaneDraft
  index: number
}

const ALL_STATUSES: TaskStatus[] = [
  'open',
  'in-progress',
  'in-review',
  'blocked',
  'done',
  'migrated',
  'cancelled',
]
const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'open',
  'in-progress': 'in-progress',
  'in-review': 'in-review',
  blocked: 'blocked',
  done: 'done',
  migrated: 'migrated',
  cancelled: 'cancelled',
}

function generateId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `lane-${Date.now()}`
  )
}

function toggled(statuses: TaskStatus[], status: TaskStatus): TaskStatus[] {
  if (statuses.includes(status)) return statuses.filter((s) => s !== status)
  return [...statuses, status]
}

/** The lanes being edited, and the edits a row makes to them. */
function useLaneDraft(lanes: KanbanLane[]) {
  const [draft, setDraft] = useState<KanbanLane[]>(
    lanes.map((l) => ({ ...l, taskStatuses: [...l.taskStatuses] }))
  )
  const patch = (index: number, change: (lane: KanbanLane) => KanbanLane) =>
    setDraft((prev) => prev.map((l, i) => (i === index ? change(l) : l)))

  return {
    draft,
    rename: (index: number, label: string) => patch(index, (l) => ({ ...l, label })),
    toggleStatus: (index: number, status: TaskStatus) =>
      patch(index, (l) => ({ ...l, taskStatuses: toggled(l.taskStatuses, status) })),
    setDotColor: (index: number, dotColor: string | undefined) =>
      patch(index, (l) => ({ ...l, dotColor })),
    remove: (index: number) => setDraft((prev) => prev.filter((_, i) => i !== index)),
    add: (label: string) =>
      setDraft((prev) => [...prev, { id: generateId(label), label, taskStatuses: [] }]),
    move: (index: number, direction: -1 | 1) => {
      const next = [...draft]
      const target = index + direction
      if (target < 0 || target >= next.length) return
      ;[next[index], next[target]] = [next[target], next[index]]
      setDraft(next)
    },
  }
}

function chipClass(checked: boolean, usedElsewhere: boolean): string {
  let cls = 'tv-lane-editor__status-chip'
  if (checked) cls += ' tv-lane-editor__status-chip--on'
  if (usedElsewhere) cls += ' tv-lane-editor__status-chip--used'
  return cls
}

/** A status chip; a status mapped to another lane cannot be chosen here. */
function StatusChip(props: RowProps & { status: TaskStatus }): React.JSX.Element {
  const { lanes, index, status } = props
  const checked = lanes.draft[index].taskStatuses.includes(status)
  const usedElsewhere =
    !checked && lanes.draft.some((l, li) => li !== index && l.taskStatuses.includes(status))
  return (
    <label
      className={chipClass(checked, usedElsewhere)}
      title={usedElsewhere ? 'Used in another lane' : status}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={usedElsewhere}
        onChange={() => lanes.toggleStatus(index, status)}
        style={{ display: 'none' }}
      />
      {STATUS_LABEL[status]}
    </label>
  )
}

function LaneHeader({ lanes, index }: RowProps): React.JSX.Element {
  return (
    <div className="tv-lane-editor__row-header">
      <div className="tv-lane-editor__reorder">
        <IconButton
          icon={ChevronUp}
          label="Move up"
          size="sm"
          onClick={() => lanes.move(index, -1)}
          disabled={index === 0}
        />
        <IconButton
          icon={ChevronDown}
          label="Move down"
          size="sm"
          onClick={() => lanes.move(index, 1)}
          disabled={index === lanes.draft.length - 1}
        />
      </div>
      <input
        className="tv-lane-editor__name-input"
        value={lanes.draft[index].label}
        onChange={(e) => lanes.rename(index, e.target.value)}
        placeholder="Lane name"
      />
      <IconButton icon={Trash2} label="Remove lane" size="sm" onClick={() => lanes.remove(index)} />
    </div>
  )
}

function DotColorRow({ lanes, index }: RowProps): React.JSX.Element {
  const lane = lanes.draft[index]
  return (
    <div className="tv-lane-editor__color-row">
      <span className="tv-lane-editor__statuses-label">Dot color:</span>
      <input
        type="color"
        className="tv-lane-editor__color-input"
        value={lane.dotColor ?? '#6366f1'}
        onChange={(e) => lanes.setDotColor(index, e.target.value)}
        title="Calendar dot color"
      />
      {lane.dotColor && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => lanes.setDotColor(index, undefined)}
          title="Reset to default"
        >
          Reset
        </Button>
      )}
    </div>
  )
}

function LaneRow({ lanes, index }: RowProps): React.JSX.Element {
  return (
    <div className="tv-lane-editor__row">
      <LaneHeader lanes={lanes} index={index} />
      <div className="tv-lane-editor__statuses">
        <span className="tv-lane-editor__statuses-label">Maps:</span>
        {ALL_STATUSES.map((status) => (
          <StatusChip key={status} lanes={lanes} index={index} status={status} />
        ))}
      </div>
      <DotColorRow lanes={lanes} index={index} />
    </div>
  )
}

function AddLaneRow({ onAdd }: { onAdd: (label: string) => void }): React.JSX.Element {
  const [newLabel, setNewLabel] = useState('')
  function addLane() {
    const label = newLabel.trim()
    if (!label) return
    onAdd(label)
    setNewLabel('')
  }
  return (
    <div className="tv-lane-editor__add-row">
      <input
        className="tv-lane-editor__name-input"
        value={newLabel}
        onChange={(e) => setNewLabel(e.target.value)}
        placeholder="New lane name…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') addLane()
        }}
      />
      <Button size="sm" icon={Plus} onClick={addLane} disabled={!newLabel.trim()}>
        Add
      </Button>
    </div>
  )
}

export function KanbanLaneEditor({ lanes, onSave, onClose }: KanbanLaneEditorProps) {
  const draft = useLaneDraft(lanes)
  return createPortal(
    <Dialog
      title="Edit Kanban Lanes"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        { label: 'Save lanes', tone: 'primary', onSelect: () => onSave(draft.draft) },
      ]}
    >
      <div className="tv-lane-editor__body">
        <p className="tv-lane-editor__hint">
          Drag tasks to a lane moves them to its first mapped status. Each status can only appear in
          one lane.
        </p>
        <div className="tv-lane-editor__list">
          {draft.draft.map((lane, i) => (
            <LaneRow key={lane.id} lanes={draft} index={i} />
          ))}
        </div>
        <AddLaneRow onAdd={draft.add} />
      </div>
    </Dialog>,
    document.body
  )
}
