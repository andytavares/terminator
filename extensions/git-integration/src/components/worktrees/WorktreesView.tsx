import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  IconButton,
  RelativeTime,
} from '@terminator/extension-ui'
import { gitAPI } from '../../api/git'
import type { LocalInventoryRow } from '../../git/local-inventory'
import type { RemoveItem, RemoveResult } from '../../git/remove-local'
import './worktrees.css'
import { recordUsage } from '@terminator/extension-sdk/renderer'

interface SessionInfo {
  sessionId: string
  projectId: string
  tabTitle: string
  type: string
}

interface ViewRow extends LocalInventoryRow {
  session: SessionInfo | null
  /** git's message when a removal of this row failed. */
  failure: string | null
}

type FlagTone = 'neutral' | 'good' | 'bad' | 'waiting'

interface Flag {
  text: string
  tone: FlagTone
}

interface RemoveDialogProps {
  repoRoot: string
  rows: ViewRow[]
  onCancel: () => void
  onDone: (results: RemoveResult[]) => void
}

interface CellProps {
  row: ViewRow
  repoRoot: string
}

interface RowProps {
  row: ViewRow
  repoRoot: string
  selected: boolean
  onToggle: (key: string, checked: boolean) => void
}

interface TableProps {
  rows: ViewRow[]
  repoRoot: string
  selected: ReadonlySet<string>
  onToggle: (key: string, checked: boolean) => void
}

interface ToolbarProps {
  selectedCount: number
  onSelectStale: () => void
  onRemove: () => void
  onRefresh: () => void
}

interface Selection {
  selected: ReadonlySet<string>
  toggle: (key: string, checked: boolean) => void
  selectStale: () => void
  clear: () => void
}

interface RemovalState {
  removing: ViewRow[] | null
  open: (rows: ViewRow[]) => void
  close: () => void
  onRemoved: (results: RemoveResult[]) => void
}

interface BodyProps {
  rows: ViewRow[]
  repoRoot: string
  selection: Selection
  onRefresh: () => void
}

interface LoadedViewProps {
  rows: ViewRow[]
  repoRoot: string
  selection: Selection
  removal: RemovalState
  onRefresh: () => void
}

const rowKey = (row: LocalInventoryRow): string => row.branch ?? `detached:${row.worktreePath}`

/** main, the current checkout and an open session are locked against removal. */
function isLockedRow(row: ViewRow): boolean {
  return row.isMain || row.isCurrent || row.session !== null
}

function isStaleRow(row: ViewRow): boolean {
  return !isLockedRow(row) && (row.merged || row.upstreamGone || row.prunable)
}

function relativePath(repoRoot: string, path: string): string {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path
}

/** The lock and session flags of the STATE column. */
function lockFlags(row: ViewRow): Flag[] {
  const flags: Flag[] = []
  if (row.isMain) flags.push({ text: 'locked · main', tone: 'neutral' })
  if (row.isCurrent) flags.push({ text: 'current', tone: 'neutral' })
  if (row.session) flags.push({ text: 'open session', tone: 'waiting' })
  return flags
}

/** 'not merged' when the branch cannot be fast-forward checked, 'no upstream' when it has none. */
function mergeabilityFlags(row: ViewRow, isBranch: boolean): Flag[] {
  if (!isBranch) return []
  const flags: Flag[] = []
  if (!row.merged && (row.upstreamGone || row.upstream === null))
    flags.push({ text: 'not merged', tone: 'waiting' })
  if (row.upstream === null) flags.push({ text: 'no upstream', tone: 'neutral' })
  return flags
}

/** The upstream flags of a branch row: merged, gone, behind, not merged, no upstream. */
function upstreamFlags(row: ViewRow): Flag[] {
  const flags: Flag[] = []
  if (row.merged) flags.push({ text: 'merged', tone: 'good' })
  if (row.upstreamGone) flags.push({ text: 'upstream gone', tone: 'waiting' })
  if (row.behind > 0) flags.push({ text: `${row.behind} behind`, tone: 'bad' })
  return [...flags, ...mergeabilityFlags(row, row.branch !== null && !row.isMain)]
}

/** The git-state flags of the STATE column, after the lock flags. */
function gitFlags(row: ViewRow): Flag[] {
  const flags: Flag[] = [...upstreamFlags(row)]
  if (row.isAgent) flags.push({ text: 'agent', tone: 'neutral' })
  if (row.project) flags.push({ text: 'Terminator branch', tone: 'neutral' })
  if (row.prunable) flags.push({ text: 'prunable', tone: 'neutral' })
  return flags
}

/** The commands the removal will run, as the dialog's <pre> lists them. */
function removalCommands(repoRoot: string, rows: ViewRow[]): string[] {
  const lines: string[] = []
  for (const row of rows) {
    if (row.worktreePath)
      lines.push(`git worktree remove ${relativePath(repoRoot, row.worktreePath)}`)
    if (row.branch)
      lines.push(
        `git branch ${row.merged ? '-d' : '-D'} ${row.branch}${row.merged ? '' : '  # not merged'}`
      )
  }
  lines.push('git worktree prune')
  return lines
}

function toRemoveItem(row: ViewRow): RemoveItem {
  return {
    branch: row.branch,
    worktreePath: row.worktreePath,
    forceBranch: !row.merged,
  }
}

function sessionForRow(row: LocalInventoryRow, sessions: SessionInfo[]): SessionInfo | null {
  if (!row.project) return null
  return sessions.find((s) => s.projectId === row.project!.id) ?? null
}

async function loadRows(repoRoot: string): Promise<ViewRow[]> {
  const [inventory, sessions] = await Promise.all([
    gitAPI.localInventory(repoRoot),
    window.electronAPI.terminal.listSessions(),
  ])
  return (inventory.rows ?? []).map((row) => ({
    ...row,
    session: sessionForRow(row, sessions as SessionInfo[]),
    failure: null,
  }))
}

interface RowsState {
  rows: ViewRow[]
  setRows: React.Dispatch<React.SetStateAction<ViewRow[]>>
  reload: () => Promise<void>
}

/** The rows of `repoRoot`, loaded on mount and reloaded on demand. */
function useInventoryRows(repoRoot: string | null): RowsState {
  const [rows, setRows] = useState<ViewRow[]>([])
  const reload = useCallback(async () => {
    if (!repoRoot) return
    const loaded = await loadRows(repoRoot)
    setRows(loaded)
  }, [repoRoot])
  useEffect(() => {
    let alive = true
    if (!repoRoot) return undefined
    void loadRows(repoRoot).then((loaded) => {
      if (alive) setRows(loaded)
    })
    return () => {
      alive = false
    }
  }, [repoRoot])
  return { rows, setRows, reload }
}

/** Each failed removal's reason, keyed by the row it names. */
function failuresByRow(results: RemoveResult[]): Map<string, string> {
  return new Map(
    results
      .filter((r) => !r.ok)
      .map((r) => [r.branch ?? `detached:${r.worktreePath}`, r.reason ?? 'failed'])
  )
}

/** Removes the rows, counts the use (failed when none went), and returns each row's result. */
async function removeAndCount(repoRoot: string, rows: ViewRow[]): Promise<RemoveResult[]> {
  const answer = await gitAPI.removeLocal(repoRoot, rows.map(toRemoveItem))
  const results = answer.results ?? []
  recordUsage('worktree-remove', results.some((r) => r.ok) ? {} : { failed: true })
  return results
}

function RemoveDialog(props: RemoveDialogProps): JSX.Element {
  const [removing, setRemoving] = useState(false)
  const confirm = async (): Promise<void> => {
    setRemoving(true)
    props.onDone(await removeAndCount(props.repoRoot, props.rows))
  }
  return (
    <Dialog
      title={`Remove ${props.rows.length} worktrees and branches?`}
      onDismiss={props.onCancel}
      actions={[
        { label: 'Cancel', onSelect: props.onCancel },
        {
          label: `Remove ${props.rows.length}`,
          tone: 'danger',
          onSelect: confirm,
          disabled: removing,
        },
      ]}
    >
      <p>This deletes the folders and local branches. Remote branches stay.</p>
      <pre className="wt-commands" data-testid="remove-commands">
        {removalCommands(props.repoRoot, props.rows).join('\n')}
      </pre>
    </Dialog>
  )
}

function WorktreeCell(props: CellProps): JSX.Element {
  if (props.row.isMain) return <span className="wt-faint">(main checkout)</span>
  if (props.row.worktreePath === null) return <span className="wt-faint">no worktree</span>
  return (
    <span className="wt-mono wt-muted">{relativePath(props.repoRoot, props.row.worktreePath)}</span>
  )
}

function SessionCell(props: { session: SessionInfo | null }): JSX.Element {
  if (!props.session) return <span className="wt-faint">—</span>
  return (
    <span>
      {props.session.tabTitle} <span className="wt-muted">{props.session.type}</span>
    </span>
  )
}

function TimeCell(props: { value: number | null }): JSX.Element {
  if (props.value === null || props.value === 0) return <span className="wt-faint">—</span>
  return <RelativeTime value={props.value} />
}

function StateCell(props: { row: ViewRow }): JSX.Element {
  const flags = [...lockFlags(props.row), ...gitFlags(props.row)]
  return (
    <span className="wt-flags">
      {flags.map((flag) => (
        <Chip key={flag.text} tone={flag.tone}>
          {flag.text}
        </Chip>
      ))}
      {props.row.failure !== null && (
        <span className="wt-failure" title={props.row.failure}>
          {props.row.failure}
        </span>
      )}
    </span>
  )
}

function SelectCell(props: RowProps): JSX.Element {
  const locked = isLockedRow(props.row)
  const name = props.row.branch ?? '(detached)'
  return (
    <td>
      <span
        role="checkbox"
        aria-checked={props.selected}
        aria-disabled={locked}
        aria-label={`Select ${name}`}
        className={locked ? 'wt-locked' : undefined}
      >
        <Checkbox
          checked={props.selected}
          label={`Select ${name} box`}
          onChange={locked ? undefined : (checked) => props.onToggle(rowKey(props.row), checked)}
        />
      </span>
    </td>
  )
}

/** The three timestamps of a row. */
function TimeCells(props: { row: ViewRow }): JSX.Element {
  const cells = [props.row.createdAt, props.row.modifiedAt, props.row.lastCommitAt]
  return (
    <>
      {cells.map((value, i) => (
        <td key={i}>
          <TimeCell value={value} />
        </td>
      ))}
    </>
  )
}

/** The identifying cells: checkbox, branch, worktree and session. */
function IdentityCells(props: RowProps): JSX.Element {
  return (
    <>
      <SelectCell {...props} />
      <td className="wt-mono wt-ellipsis">{props.row.branch ?? '(detached)'}</td>
      <td className="wt-ellipsis">
        <WorktreeCell row={props.row} repoRoot={props.repoRoot} />
      </td>
      <td>
        <SessionCell session={props.row.session} />
      </td>
    </>
  )
}

function WorktreeRow(props: RowProps): JSX.Element {
  const rowClass = props.selected ? 'wt-row wt-row--selected' : 'wt-row'
  return (
    <tr className={rowClass}>
      <IdentityCells {...props} />
      <TimeCells row={props.row} />
      <td>
        <StateCell row={props.row} />
      </td>
    </tr>
  )
}

const COLUMNS = ['BRANCH', 'WORKTREE', 'SESSION', 'CREATED', 'MODIFIED', 'LAST COMMIT', 'STATE']

function InventoryTable(props: TableProps): JSX.Element {
  return (
    <table className="wt-table">
      <thead>
        <tr>
          <th />
          <th>{COLUMNS[0]}</th>
          <th>{COLUMNS[1]}</th>
          <th>{COLUMNS[2]}</th>
          <th>{COLUMNS[3]}</th>
          <th>{COLUMNS[4]}</th>
          <th>{COLUMNS[5]}</th>
          <th>{COLUMNS[6]}</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <WorktreeRow
            key={rowKey(row)}
            row={row}
            repoRoot={props.repoRoot}
            selected={props.selected.has(rowKey(row))}
            onToggle={props.onToggle}
          />
        ))}
      </tbody>
    </table>
  )
}

/** The toolbar: Select stale, Remove selected and Refresh at the right. */
function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div className="wt-toolbar">
      <span className="wt-toolbar-spacer" />
      <Button variant="secondary" size="sm" onClick={props.onSelectStale}>
        Select stale
      </Button>
      <Button
        variant="danger"
        size="sm"
        disabled={props.selectedCount === 0}
        onClick={props.onRemove}
      >
        Remove selected · {props.selectedCount}
      </Button>
      <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={props.onRefresh} />
    </div>
  )
}

function useSelection(rows: ViewRow[]): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(key)
    else next.delete(key)
    setSelected(next)
  }
  const selectStale = (): void => setSelected(new Set(rows.filter(isStaleRow).map(rowKey)))
  const clear = (): void => setSelected(new Set())
  return { selected, toggle, selectStale, clear }
}

function useRemoval(
  setRows: React.Dispatch<React.SetStateAction<ViewRow[]>>,
  clear: () => void,
  reload: () => Promise<void>
): RemovalState {
  const [removing, setRemoving] = useState<ViewRow[] | null>(null)
  const onRemoved = (results: RemoveResult[]): void => {
    setRemoving(null)
    clear()
    const failed = failuresByRow(results)
    if (failed.size === 0) return void reload()
    setRows((current) =>
      current.map((row) => {
        const reason = failed.get(rowKey(row))
        return reason === undefined ? row : { ...row, failure: reason }
      })
    )
  }
  return { removing, open: setRemoving, close: () => setRemoving(null), onRemoved }
}

/** The table, or the empty state when only the main checkout is left. */
function WorktreesBody(props: BodyProps): JSX.Element {
  if (props.rows.every((row) => row.isMain))
    return (
      <EmptyState
        heading="No other branches or worktrees"
        description="Only the main checkout is here."
        actions={[{ label: 'Refresh', onSelect: props.onRefresh }]}
      />
    )
  const { rows, repoRoot, selection } = props
  const table = { rows, repoRoot, selected: selection.selected, onToggle: selection.toggle }
  return <InventoryTable {...table} />
}

/** The tab once a repository is named: toolbar, table and the removal dialog. */
function LoadedView(props: LoadedViewProps): JSX.Element {
  const { rows, repoRoot, selection, removal, onRefresh } = props
  const selectedRows = rows.filter((row) => selection.selected.has(rowKey(row)))
  const toolbar = {
    selectedCount: selectedRows.length,
    onSelectStale: selection.selectStale,
    onRemove: () => removal.open(selectedRows),
    onRefresh,
  }
  const body = { rows, repoRoot, selection, onRefresh }
  return (
    <div className="wt-view">
      <Toolbar {...toolbar} />
      <WorktreesBody {...body} />
      {removal.removing !== null && (
        <RemoveDialog
          repoRoot={repoRoot}
          rows={removal.removing}
          onCancel={removal.close}
          onDone={removal.onRemoved}
        />
      )}
    </div>
  )
}

/** The Worktrees tab: every local branch and worktree, and the cleanup of the stale ones. */
export function WorktreesView(props: { repoRoot: string | null }): JSX.Element {
  const { rows, setRows, reload } = useInventoryRows(props.repoRoot)
  const selection = useSelection(rows)
  const removal = useRemoval(setRows, selection.clear, reload)
  if (!props.repoRoot)
    return (
      <EmptyState
        heading="No repository"
        description="Pick a repository first."
        actions={[{ label: 'OK', onSelect: () => {} }]}
      />
    )
  const onRefresh = (): void => void reload()
  const view = { rows, repoRoot: props.repoRoot, selection, removal, onRefresh }
  return <LoadedView {...view} />
}
