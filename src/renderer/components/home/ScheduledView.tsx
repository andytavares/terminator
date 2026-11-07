import React, { useState } from 'react'
import { CalendarClock, Ellipsis } from 'lucide-react'
import {
  Chip,
  ConfirmDialog,
  DataTable,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  type DataTableColumn,
  type DataTableGroup,
} from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { agentLabel, useAgentChoices } from './agent-choices'
import { useRunAsOptions, useStartWorkStore } from './start-work'
import { runLabel } from './WhenChoices'
import {
  groupRuns,
  nextRunOf,
  scheduledRunCount,
  soonestRun,
  useSavedRuns,
  whenOf,
  type RunGroup,
} from './scheduled-runs'
import type { Schedule } from '../../../shared/schemas/schedules.schema'
import type { Workspace } from '../../../shared/types/index'
import './ScheduledView.css'

type SavedRuns = ReturnType<typeof useSavedRuns>

/** "5 scheduled runs · 1 paused · next: Mon 9 Nov 08:30, Summarise …". */
function SummaryLine({ runs }: { runs: Schedule[] }): React.JSX.Element {
  const paused = runs.filter((s) => s.paused).length
  const next = soonestRun(runs, new Date())
  return (
    <p className="scheduled__summary">
      <b>{scheduledRunCount(runs.length)}</b>
      {paused > 0 && ` · ${paused} paused`}
      {next !== null && ` · next: ${runLabel(next.at)}, ${next.schedule.prompt}`}
    </p>
  )
}

function groupSummary(group: RunGroup): React.ReactNode {
  if (group.global)
    return (
      <>
        <b>Global</b> — no workspace · runs in your home folder, shows in Scratch
      </>
    )
  return (
    <>
      <b>{group.name}</b> · {group.runs.length}
    </>
  )
}

function RowMenu(props: RowMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = `Actions for ${props.schedule.prompt}`
  return (
    // The row opens edit on a click or Enter; the menu's own presses stay in the menu.
    <div
      className="scheduled__menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <IconButton icon={Ellipsis} size="sm" label={label} onClick={() => setOpen((v) => !v)} />
      {open && (
        <Menu label={label} align="end" onDismiss={() => setOpen(false)}>
          <RowMenuItems {...props} close={() => setOpen(false)} />
        </Menu>
      )}
    </div>
  )
}

function RowMenuItems({ schedule, saved, onRemove, close }: RowMenuProps & { close: () => void }) {
  const pick = (action: () => void) => () => {
    close()
    action()
  }
  return (
    <>
      <MenuItem onSelect={pick(() => void saved.runNow(schedule))}>Run now</MenuItem>
      <MenuItem onSelect={pick(() => void saved.setPaused(schedule, !schedule.paused))}>
        {schedule.paused ? 'Resume' : 'Pause'}
      </MenuItem>
      <MenuItem onSelect={pick(() => saved.edit(schedule))}>Edit…</MenuItem>
      <MenuItem danger onSelect={pick(() => onRemove(schedule))}>
        Remove…
      </MenuItem>
    </>
  )
}

interface RowMenuProps {
  schedule: Schedule
  saved: SavedRuns
  onRemove: (schedule: Schedule) => void
}

/** The run-as labels Start work shows, by value. */
function useRunAsLabels(): Map<string, string> {
  const options = useRunAsOptions(agentLabel(useAgentChoices(), null))
  return new Map(options.map((o) => [o.value, o.label]))
}

function useColumns(saved: SavedRuns, onRemove: RowMenuProps['onRemove']) {
  const runAs = useRunAsLabels()
  const columns: DataTableColumn<Schedule>[] = [
    {
      id: 'prompt',
      header: 'Prompt',
      render: (s) => <span className="scheduled__prompt">{s.prompt}</span>,
    },
    { id: 'when', header: 'When', render: whenOf },
    { id: 'next', header: 'Next run', render: nextRunCell },
    {
      id: 'last',
      header: 'Last run',
      render: (s) => (s.lastRunAt === null ? 'Never' : runLabel(new Date(s.lastRunAt))),
    },
    { id: 'run-as', header: 'Run as', render: (s) => runAs.get(s.runAs) ?? s.runAs },
    {
      id: 'actions',
      header: '',
      render: (s) => <RowMenu schedule={s} saved={saved} onRemove={onRemove} />,
    },
  ]
  return columns
}

function nextRunCell(schedule: Schedule): React.ReactNode {
  if (schedule.paused) return <Chip>Paused</Chip>
  const at = nextRunOf(schedule, new Date())
  return at === null ? 'None' : runLabel(at)
}

function NoRuns(): React.JSX.Element {
  return (
    <EmptyState
      icon={CalendarClock}
      heading="No scheduled runs"
      description="Type a prompt in Start work and set When to Once or Repeat to save one."
      actions={[
        {
          label: 'New scheduled run',
          tone: 'primary',
          onSelect: () => useStartWorkStore.getState().openScheduledRun(),
        },
      ]}
    />
  )
}

const tableGroups = (runs: Schedule[], workspaces: Workspace[]): DataTableGroup<Schedule>[] =>
  groupRuns(runs, workspaces).map((group) => ({
    id: group.id,
    summary: groupSummary(group),
    rows: group.runs,
  }))

/** Asks before a run goes: its prompt is what will be removed. */
function RemoveDialog({ schedule, saved, onClose }: RemoveDialogProps): React.JSX.Element {
  return (
    <ConfirmDialog
      title="Remove this scheduled run?"
      description={schedule.prompt}
      confirmLabel="Remove"
      danger
      onClose={onClose}
      onConfirm={() => {
        onClose()
        void saved.remove(schedule)
      }}
    />
  )
}

interface RemoveDialogProps {
  schedule: Schedule
  saved: SavedRuns
  onClose: () => void
}

/** Home's Scheduled view: every saved prompt, grouped Global first, then by workspace. */
export function ScheduledView(): React.JSX.Element | null {
  const saved = useSavedRuns()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const [removing, setRemoving] = useState<Schedule | null>(null)
  const columns = useColumns(saved, setRemoving)
  if (saved.runs === null) return null
  return (
    <div className="scheduled">
      {saved.runs.length === 0 ? (
        <NoRuns />
      ) : (
        <>
          <SummaryLine runs={saved.runs} />
          <DataTable
            label="Scheduled runs"
            columns={columns}
            groups={tableGroups(saved.runs, workspaces)}
            rowKey={(s) => s.id}
            onRowClick={saved.edit}
          />
        </>
      )}
      {removing !== null && (
        <RemoveDialog schedule={removing} saved={saved} onClose={() => setRemoving(null)} />
      )}
    </div>
  )
}
