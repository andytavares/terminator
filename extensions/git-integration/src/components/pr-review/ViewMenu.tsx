import React, { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown } from 'lucide-react'
import { Button, Popover, SegmentedControl } from '@terminator/extension-ui'
import { useReviewUiStore } from '../../stores/review-ui.store'
import './view-menu.css'

/** The review's own file filters, which live in the view rather than in the saved settings. */
export interface FileFilters {
  focusMode: boolean
  onToggleFocusMode: () => void
  /** Changed files the viewer owns; the filter has nothing to show when it is 0. */
  ownedCount: number
  ownedOnly: boolean
  onToggleOwnedOnly: () => void
}

const GROUP_BY_OPTIONS = [
  { value: 'chapters', label: 'Chapters' },
  { value: 'all', label: 'All files' },
] as const

const COMMENT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'hidden', label: 'Hidden' },
] as const

const AGENT_NOTE_OPTIONS = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const

const LAYOUT_OPTIONS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const

/** The view settings the menu edits, with their setters. */
function useViewSettings() {
  return useReviewUiStore(
    useShallow((s) => ({
      commentVisibility: s.commentVisibility,
      setCommentVisibility: s.setCommentVisibility,
      agentNotesOn: s.agentNotesOn,
      setAgentNotesOn: s.setAgentNotesOn,
      diffViewMode: s.diffViewMode,
      setDiffViewMode: s.setDiffViewMode,
      hideFormattingHunks: s.hideFormattingHunks,
      setHideFormattingHunks: s.setHideFormattingHunks,
      groupBy: s.groupBy,
      setGroupBy: s.setGroupBy,
      fileListHidden: s.fileListHidden,
      toggleFileList: s.toggleFileList,
    }))
  )
}

type ViewSettings = ReturnType<typeof useViewSettings>

/** True when any setting differs from its default. */
function settingsChanged(v: ViewSettings): boolean {
  if (v.commentVisibility !== 'all' || !v.agentNotesOn) return true
  return v.diffViewMode !== 'unified' || !v.hideFormattingHunks
}

function menuLabel(v: ViewSettings): string {
  if (v.commentVisibility === 'hidden') return 'View · comments hidden'
  if (settingsChanged(v)) return 'View (changed)'
  return 'View'
}

function agentNotesValue(on: boolean): 'on' | 'off' {
  if (on) return 'on'
  return 'off'
}

function MenuGroup(props: { label: string; kbd?: string; children: React.ReactNode }) {
  return (
    <div className="vm-group">
      <div className="vm-group-label">
        {props.label}
        {props.kbd && <span className="vm-kbd">{props.kbd}</span>}
      </div>
      {props.children}
    </div>
  )
}

interface SwitchRowProps {
  label: string
  hint?: React.ReactNode
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}

function SwitchRow(props: SwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className="vm-switch-row"
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <span className="vm-switch" aria-hidden="true" />
      {props.label}
      {props.hint && <span className="vm-kbd">{props.hint}</span>}
    </button>
  )
}

function ownedHint(ownedCount: number): string {
  if (ownedCount > 0) return String(ownedCount)
  return 'none owned'
}

function FilesGroup({ v, filters }: { v: ViewSettings; filters: FileFilters }) {
  return (
    <MenuGroup label="Files">
      <SegmentedControl
        label="File list"
        size="sm"
        options={[...GROUP_BY_OPTIONS]}
        value={v.groupBy}
        onChange={v.setGroupBy}
      />
      <SwitchRow
        label="Show file list"
        hint="t"
        checked={!v.fileListHidden}
        onToggle={v.toggleFileList}
      />
      <FilterSwitches filters={filters} />
    </MenuGroup>
  )
}

function FilterSwitches({ filters }: { filters: FileFilters }) {
  return (
    <>
      <SwitchRow
        label="Only my files"
        hint={ownedHint(filters.ownedCount)}
        checked={filters.ownedOnly}
        disabled={filters.ownedCount === 0}
        onToggle={filters.onToggleOwnedOnly}
      />
      <SwitchRow
        label="Focus mode"
        checked={filters.focusMode}
        onToggle={filters.onToggleFocusMode}
      />
    </>
  )
}

function DiffGroup({ v }: { v: ViewSettings }) {
  return (
    <MenuGroup label="Diff">
      <SegmentedControl
        label="Diff view mode"
        size="sm"
        options={[...LAYOUT_OPTIONS]}
        value={v.diffViewMode}
        onChange={v.setDiffViewMode}
      />
      <SwitchRow
        label="Hide formatting-only hunks"
        checked={v.hideFormattingHunks}
        onToggle={() => v.setHideFormattingHunks(!v.hideFormattingHunks)}
      />
    </MenuGroup>
  )
}

function CommentsGroup({ v }: { v: ViewSettings }) {
  return (
    <MenuGroup label="Comments" kbd="c">
      <SegmentedControl
        label="Comment visibility"
        size="sm"
        options={[...COMMENT_OPTIONS]}
        value={v.commentVisibility}
        onChange={v.setCommentVisibility}
      />
    </MenuGroup>
  )
}

function AgentNotesGroup({ v }: { v: ViewSettings }) {
  return (
    <MenuGroup label="Agent notes" kbd="⇧C">
      <SegmentedControl
        label="Agent notes"
        size="sm"
        options={[...AGENT_NOTE_OPTIONS]}
        value={agentNotesValue(v.agentNotesOn)}
        onChange={(value) => v.setAgentNotesOn(value === 'on')}
      />
    </MenuGroup>
  )
}

function ViewMenuGroups({ v, filters }: { v: ViewSettings; filters: FileFilters }) {
  return (
    <>
      <FilesGroup v={v} filters={filters} />
      <DiffGroup v={v} />
      <div className="vm-group-label">Notes</div>
      <CommentsGroup v={v} />
      <AgentNotesGroup v={v} />
    </>
  )
}

/** The review's one settings menu: how files are listed and filtered, the diff, and notes. */
export function ViewMenu({ filters }: { filters: FileFilters }) {
  const [open, setOpen] = useState(false)
  const v = useViewSettings()
  const label = menuLabel(v)
  const hidden = v.commentVisibility === 'hidden'
  return (
    <div className="vm">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={(hidden && label) || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        View
        {settingsChanged(v) && <span className="vm-dot" aria-hidden="true" data-testid="vm-dot" />}
        <ChevronDown aria-hidden="true" className="tm-icon-sm" />
      </Button>
      {open && (
        <Popover label="View" align="end" onDismiss={() => setOpen(false)} className="vm-popover">
          <ViewMenuGroups v={v} filters={filters} />
        </Popover>
      )}
    </div>
  )
}
