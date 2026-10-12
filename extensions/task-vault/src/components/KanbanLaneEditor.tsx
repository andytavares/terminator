import React, { useState } from 'react'
import { Button, Dialog, IconButton } from '@terminator/extension-ui'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { KanbanLane, TaskStatus } from '../vault/types'

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

interface KanbanLaneEditorProps {
  lanes: KanbanLane[]
  onSave: (lanes: KanbanLane[]) => void
  onClose: () => void
}

function generateId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `lane-${Date.now()}`
  )
}

export function KanbanLaneEditor({ lanes, onSave, onClose }: KanbanLaneEditorProps) {
  const [draft, setDraft] = useState<KanbanLane[]>(
    lanes.map((l) => ({ ...l, taskStatuses: [...l.taskStatuses] }))
  )
  const [newLabel, setNewLabel] = useState('')

  function updateLabel(index: number, label: string) {
    setDraft((prev) => prev.map((l, i) => (i === index ? { ...l, label } : l)))
  }

  function toggleStatus(index: number, status: TaskStatus) {
    setDraft((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l
        const has = l.taskStatuses.includes(status)
        return {
          ...l,
          taskStatuses: has
            ? l.taskStatuses.filter((s) => s !== status)
            : [...l.taskStatuses, status],
        }
      })
    )
  }

  function removeLane(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  function updateDotColor(index: number, dotColor: string | undefined) {
    setDraft((prev) => prev.map((l, i) => (i === index ? { ...l, dotColor } : l)))
  }

  function addLane() {
    const label = newLabel.trim()
    if (!label) return
    setDraft((prev) => [...prev, { id: generateId(label), label, taskStatuses: [] }])
    setNewLabel('')
  }

  function moveLane(index: number, direction: -1 | 1) {
    const next = [...draft]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft(next)
  }

  return createPortal(
    <Dialog
      title="Edit Kanban Lanes"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        { label: 'Save lanes', tone: 'primary', onSelect: () => onSave(draft) },
      ]}
    >
      <div className="tv-lane-editor__body">
        <p className="tv-lane-editor__hint">
          Drag tasks to a lane moves them to its first mapped status. Each status can only appear in
          one lane.
        </p>

        <div className="tv-lane-editor__list">
          {draft.map((lane, i) => (
            <div key={lane.id} className="tv-lane-editor__row">
              <div className="tv-lane-editor__row-header">
                <div className="tv-lane-editor__reorder">
                  <IconButton
                    icon={ChevronUp}
                    label="Move up"
                    size="sm"
                    onClick={() => moveLane(i, -1)}
                    disabled={i === 0}
                  />
                  <IconButton
                    icon={ChevronDown}
                    label="Move down"
                    size="sm"
                    onClick={() => moveLane(i, 1)}
                    disabled={i === draft.length - 1}
                  />
                </div>
                <input
                  className="tv-lane-editor__name-input"
                  value={lane.label}
                  onChange={(e) => updateLabel(i, e.target.value)}
                  placeholder="Lane name"
                />
                <IconButton
                  icon={Trash2}
                  label="Remove lane"
                  size="sm"
                  onClick={() => removeLane(i)}
                />
              </div>
              <div className="tv-lane-editor__statuses">
                <span className="tv-lane-editor__statuses-label">Maps:</span>
                {ALL_STATUSES.map((status) => {
                  const checked = lane.taskStatuses.includes(status)
                  const usedElsewhere =
                    !checked && draft.some((l, li) => li !== i && l.taskStatuses.includes(status))
                  return (
                    <label
                      key={status}
                      className={`tv-lane-editor__status-chip${checked ? ' tv-lane-editor__status-chip--on' : ''}${usedElsewhere ? ' tv-lane-editor__status-chip--used' : ''}`}
                      title={usedElsewhere ? 'Used in another lane' : status}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={usedElsewhere}
                        onChange={() => toggleStatus(i, status)}
                        style={{ display: 'none' }}
                      />
                      {STATUS_LABEL[status]}
                    </label>
                  )
                })}
              </div>
              <div className="tv-lane-editor__color-row">
                <span className="tv-lane-editor__statuses-label">Dot color:</span>
                <input
                  type="color"
                  className="tv-lane-editor__color-input"
                  value={lane.dotColor ?? '#6366f1'}
                  onChange={(e) => updateDotColor(i, e.target.value)}
                  title="Calendar dot color"
                />
                {lane.dotColor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateDotColor(i, undefined)}
                    title="Reset to default"
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

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
      </div>
    </Dialog>,
    document.body
  )
}
