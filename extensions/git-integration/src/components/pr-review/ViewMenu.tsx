import React, { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown } from 'lucide-react'
import { Button, Popover, SegmentedControl } from '@terminator/extension-ui'
import { useReviewUiStore } from '../../stores/review-ui.store'
import './view-menu.css'

export interface ViewMenuProps {
  /** Muted text shown at the bottom of the menu, e.g. "Showing a1b2… head". */
  sinceNote?: string | null
}

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

function FormattingSwitch({ v }: { v: ViewSettings }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={v.hideFormattingHunks}
      className="vm-switch-row"
      onClick={() => v.setHideFormattingHunks(!v.hideFormattingHunks)}
    >
      <span className="vm-switch" aria-hidden="true" />
      Hide formatting-only hunks
    </button>
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

function LayoutGroup({ v }: { v: ViewSettings }) {
  return (
    <MenuGroup label="Layout">
      <SegmentedControl
        label="Diff view mode"
        size="sm"
        options={[...LAYOUT_OPTIONS]}
        value={v.diffViewMode}
        onChange={v.setDiffViewMode}
      />
    </MenuGroup>
  )
}

function ViewMenuGroups({ v }: { v: ViewSettings }) {
  return (
    <>
      <CommentsGroup v={v} />
      <AgentNotesGroup v={v} />
      <LayoutGroup v={v} />
    </>
  )
}

/** File-header menu: comments, agent notes, diff layout and the formatting filter. */
export function ViewMenu({ sinceNote }: ViewMenuProps) {
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
        {settingsChanged(v) && <span className="vm-dot" aria-hidden="true" />}
        <ChevronDown aria-hidden="true" className="tm-icon-sm" />
      </Button>
      {open && (
        <Popover label="View" onDismiss={() => setOpen(false)} className="vm-popover">
          <ViewMenuGroups v={v} />
          <FormattingSwitch v={v} />
          {sinceNote && <div className="vm-since">{sinceNote}</div>}
        </Popover>
      )}
    </div>
  )
}
