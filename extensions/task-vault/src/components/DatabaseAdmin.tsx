import React, { useCallback, useEffect, useState } from 'react'
import { Play, RefreshCw, Trash2 } from 'lucide-react'
import { invoke } from '@terminator/extension-sdk/renderer'
import { Button, IconButton } from '@terminator/extension-ui'
import { countLabel } from '../utils/count-label'

interface TableStats {
  [table: string]: number
}

interface QueryResult {
  rows: Record<string, unknown>[]
  changes: number
  error?: string
  elapsed?: number
  sourceSql?: string
}

interface ConfirmPending {
  title: string
  sql: string
}

interface QueryAnswer {
  rows?: Record<string, unknown>[]
  changes?: number
  error?: string
}

type Admin = ReturnType<typeof useAdmin>

interface AdminProps {
  admin: Admin
}

interface RowsProps {
  admin: Admin
  result: QueryResult
  /** The table rows can be deleted from, when the query read one table with an id column. */
  table: string | null
}

interface RowProps extends RowsProps {
  row: Record<string, unknown>
  columns: string[]
}

interface QuickActionDef {
  label: string
  sql: string
  destructive?: boolean
}

interface StatChipProps {
  admin: Admin
  table: string
  count: number
}

const QUICK_ACTIONS: QuickActionDef[] = [
  {
    label: 'Count tasks by status',
    sql: 'SELECT status, COUNT(*) AS count FROM tasks GROUP BY status ORDER BY count DESC',
  },
  {
    label: 'Show orphaned subtasks',
    sql: 'SELECT t.* FROM tasks t WHERE t.parent_id IS NOT NULL AND t.parent_id NOT IN (SELECT id FROM tasks)',
  },
  {
    label: 'Delete orphaned subtasks',
    sql: 'DELETE FROM tasks WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM tasks)',
    destructive: true,
  },
  {
    label: 'Show cancelled tasks',
    sql: "SELECT id, text, created_at, updated_at FROM tasks WHERE status = 'cancelled' ORDER BY updated_at DESC",
  },
  {
    label: 'Delete all cancelled tasks',
    sql: "DELETE FROM tasks WHERE status = 'cancelled'",
    destructive: true,
  },
  {
    label: 'Show migrated tasks',
    sql: "SELECT id, text, migrated_to, updated_at FROM tasks WHERE status = 'migrated' ORDER BY updated_at DESC",
  },
  {
    label: 'Delete all migrated tasks',
    sql: "DELETE FROM tasks WHERE status = 'migrated'",
    destructive: true,
  },
  {
    label: 'Tasks with no project or area',
    sql: 'SELECT id, text, status, source FROM tasks WHERE project_id IS NULL AND area_id IS NULL AND parent_id IS NULL ORDER BY created_at DESC',
  },
  {
    label: 'Vacuum database',
    sql: 'VACUUM',
    destructive: false,
  },
]

function extractTableName(querySql: string): string | null {
  const match = /\bFROM\s+(\w+)/i.exec(querySql)
  return match ? match[1] : null
}

async function fetchStats(): Promise<TableStats | null> {
  const res = await invoke<{ stats?: TableStats; error?: string }>('task-vault:admin:table-stats')
  return res.stats ?? null
}

/** Runs one query and times it; `wrote` says whether it changed rows rather than reading them. */
async function executeQuery(querySql: string): Promise<{ result: QueryResult; wrote: boolean }> {
  const start = Date.now()
  try {
    const res = await invoke<QueryAnswer>('task-vault:admin:run-query', { sql: querySql })
    const elapsed = Date.now() - start
    if (res.error) {
      return {
        result: { rows: [], changes: 0, error: res.error, elapsed, sourceSql: querySql },
        wrote: false,
      }
    }
    const result = { rows: res.rows ?? [], changes: res.changes ?? 0, elapsed, sourceSql: querySql }
    // A write answers with an empty row list too, so it shows as rows it changed.
    return { result, wrote: result.changes > 0 }
  } catch (err) {
    const result = {
      rows: [],
      changes: 0,
      error: String(err),
      elapsed: Date.now() - start,
      sourceSql: querySql,
    }
    return { result, wrote: false }
  }
}

function useTableStats() {
  const [stats, setStats] = useState<TableStats | null>(null)
  const loadStats = useCallback(async () => {
    const loaded = await fetchStats()
    if (loaded) setStats(loaded)
  }, [])
  useEffect(() => {
    void fetchStats().then((loaded) => {
      if (loaded) setStats(loaded)
    })
  }, [])
  return { stats, loadStats }
}

/** Table counts, the editor's SQL, the last result, and the confirmation waiting to run. */
function useAdmin(onWrite?: () => void) {
  const { stats, loadStats } = useTableStats()
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [confirmPending, setConfirmPending] = useState<ConfirmPending | null>(null)

  async function runAdminQuery(querySql: string) {
    if (!querySql.trim()) return
    setRunning(true)
    setResult(null)
    const { result: next, wrote } = await executeQuery(querySql)
    setResult(next)
    if (!next.error) void loadStats()
    if (wrote) onWrite?.()
    setRunning(false)
  }

  const show = (querySql: string) => {
    setSql(querySql)
    void runAdminQuery(querySql)
  }
  return {
    ...{ stats, loadStats, sql, setSql, result, running },
    ...{ runQuery: runAdminQuery, show, confirmPending, setConfirmPending },
  }
}

function confirmClearTable(admin: Admin, table: string) {
  admin.setConfirmPending({ title: `Clear all rows from "${table}"?`, sql: `DELETE FROM ${table}` })
}

/** An id as SQL: strings quoted, anything else as written. */
function sqlLiteral(id: unknown): string {
  if (typeof id === 'string') return "'" + id + "'"
  return String(id)
}

function confirmDeleteRow(admin: Admin, row: Record<string, unknown>, table: string) {
  const id = row['id']
  if (id == null) return
  const idStr = sqlLiteral(id)
  admin.setConfirmPending({
    title: 'Delete row from "' + table + '"?',
    sql: 'DELETE FROM ' + table + ' WHERE id = ' + idStr,
  })
}

function StatChip(props: StatChipProps): React.JSX.Element {
  const { admin, table, count } = props
  return (
    <div className="db-admin__stat-chip-wrap">
      <div
        className="db-admin__stat-chip"
        onClick={() => admin.show('SELECT * FROM ' + table + ' LIMIT 100')}
        title={'Browse ' + table}
      >
        <span className="db-admin__stat-table">{table}</span>
        <span className="db-admin__stat-count">{count}</span>
      </div>
      <IconButton
        icon={Trash2}
        label={'Clear all rows from ' + table}
        className="db-admin__stat-clear"
        size="sm"
        onClick={() => confirmClearTable(admin, table)}
      />
    </div>
  )
}

function TableStatsPanel({ admin }: AdminProps): React.JSX.Element {
  const { stats } = admin
  return (
    <div className="db-admin__stats">
      <div className="db-admin__stats-header">
        <span className="db-admin__section-title">Tables</span>
        <IconButton
          icon={RefreshCw}
          label="Refresh tables"
          size="sm"
          onClick={() => void admin.loadStats()}
        />
      </div>
      {!stats && <span className="db-admin__muted">Loading…</span>}
      {stats && (
        <div className="db-admin__stats-grid">
          {Object.entries(stats).map(([table, count]) => (
            <StatChip key={table} admin={admin} table={table} count={count} />
          ))}
        </div>
      )}
    </div>
  )
}

function QueryQuickActions({ admin }: AdminProps): React.JSX.Element {
  const chooseQuickAction = (action: QuickActionDef) => {
    if (action.destructive)
      admin.setConfirmPending({ title: 'Run destructive query?', sql: action.sql })
    else admin.show(action.sql)
  }
  return (
    <div className="db-admin__section">
      <span className="db-admin__section-title">Quick actions</span>
      <div className="db-admin__actions">
        {QUICK_ACTIONS.map((a) => (
          <Button
            key={a.label}
            variant={a.destructive ? 'danger' : 'ghost'}
            size="sm"
            onClick={() => chooseQuickAction(a)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Cmd/Ctrl+Enter runs the editor's SQL. */
function runOnModEnter(run: () => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }
}

function SqlEditor({ admin }: AdminProps): React.JSX.Element {
  const runTypedQuery = () => void admin.runQuery(admin.sql)
  return (
    <div className="db-admin__section db-admin__editor-section">
      <span className="db-admin__section-title">SQL</span>
      <div className="db-admin__editor-row">
        <textarea
          className="db-admin__editor"
          value={admin.sql}
          onChange={(e) => admin.setSql(e.target.value)}
          onKeyDown={runOnModEnter(runTypedQuery)}
          placeholder="SELECT * FROM tasks LIMIT 50"
          rows={4}
          spellCheck={false}
        />
        <Button
          variant="primary"
          icon={Play}
          onClick={runTypedQuery}
          disabled={admin.running || !admin.sql.trim()}
          title="Run (⌘↵)"
        >
          {admin.running ? 'Running…' : 'Run'}
        </Button>
      </div>
    </div>
  )
}

/** How long the query took, after `lead`; nothing when it was not timed. */
function elapsedText(result: QueryResult, lead: string): string | false {
  if (result.elapsed == null) return false
  return lead + result.elapsed + 'ms'
}

function ResultMeta({ result, table }: Omit<RowsProps, 'admin'>): React.JSX.Element {
  return (
    <div className="db-admin__result-meta">
      {countLabel(result.rows.length, 'row')} {elapsedText(result, '· ')}
      {table && (
        <span className="db-admin__result-hint">
          {' · click '}
          <Trash2 className="tm-icon-sm" style={{ display: 'inline', verticalAlign: 'middle' }} />
          {' to delete a row'}
        </span>
      )}
    </div>
  )
}

function ResultRow(props: Omit<RowProps, 'result'>): React.JSX.Element {
  const { admin, table, row, columns } = props
  return (
    <tr className="db-admin__data-row">
      {table && (
        <td className="db-admin__action-col">
          <IconButton
            icon={Trash2}
            label="Delete this row"
            className="db-admin__row-delete"
            size="sm"
            onClick={() => confirmDeleteRow(admin, row, table)}
          />
        </td>
      )}
      {columns.map((c) => (
        <td key={c}>{String(row[c] ?? '')}</td>
      ))}
    </tr>
  )
}

function ResultTable({ admin, result, table }: RowsProps): React.JSX.Element {
  const columns = Object.keys(result.rows[0])
  return (
    <div className="db-admin__table-wrap">
      <table className="db-admin__table">
        <thead>
          <tr>
            {table && <th className="db-admin__action-col" />}
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <ResultRow key={i} admin={admin} table={table} row={row} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The table rows can be deleted from: the query's FROM table, when its rows carry an id. */
function deletableTable(result: QueryResult): string | null {
  if (result.rows.length === 0) return null
  if (!Object.keys(result.rows[0]).includes('id')) return null
  if (!result.sourceSql) return null
  return extractTableName(result.sourceSql)
}

function Results({ admin, result }: { admin: Admin; result: QueryResult }): React.JSX.Element {
  if (result.error) return <div className="db-admin__error">{result.error}</div>
  if (result.rows.length === 0) {
    return (
      <div className="db-admin__result-meta">
        {countLabel(result.changes, 'row')} affected
        {elapsedText(result, ' · ')}
      </div>
    )
  }
  const table = deletableTable(result)
  return (
    <>
      <ResultMeta result={result} table={table} />
      <ResultTable admin={admin} result={result} table={table} />
    </>
  )
}

function QueryConfirmDialog({ admin }: AdminProps): React.JSX.Element | null {
  const pending = admin.confirmPending
  if (!pending) return null
  const closeConfirm = () => admin.setConfirmPending(null)
  const confirmPendingQuery = () => {
    closeConfirm()
    admin.show(pending.sql)
  }
  return (
    <div className="db-admin__confirm-backdrop" onClick={closeConfirm}>
      <div className="db-admin__confirm" onClick={(e) => e.stopPropagation()}>
        <p className="db-admin__confirm-title">{pending.title}</p>
        <p className="db-admin__confirm-sql">{pending.sql}</p>
        <div className="db-admin__confirm-actions">
          <Button variant="danger" onClick={confirmPendingQuery}>
            Run
          </Button>
          <Button variant="ghost" onClick={closeConfirm}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DatabaseAdmin({ onWrite }: { onWrite?: () => void }): JSX.Element {
  const admin = useAdmin(onWrite)
  return (
    <div className="db-admin">
      <TableStatsPanel admin={admin} />
      <QueryQuickActions admin={admin} />
      <SqlEditor admin={admin} />
      {admin.result && (
        <div className="db-admin__results">
          <Results admin={admin} result={admin.result} />
        </div>
      )}
      <QueryConfirmDialog admin={admin} />
    </div>
  )
}
