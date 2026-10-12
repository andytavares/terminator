import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Play, RefreshCw, Trash2 } from 'lucide-react'
import { invoke } from '@terminator/extension-sdk/renderer'
import { Button, IconButton } from '@terminator/extension-ui'

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

const QUICK_ACTIONS = [
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

export function DatabaseAdmin({ onWrite }: { onWrite?: () => void }): JSX.Element {
  const [stats, setStats] = useState<TableStats | null>(null)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [confirmPending, setConfirmPending] = useState<ConfirmPending | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadStats = useCallback(async () => {
    const loaded = await fetchStats()
    if (loaded) setStats(loaded)
  }, [])

  useEffect(() => {
    void fetchStats().then((loaded) => {
      if (loaded) setStats(loaded)
    })
  }, [])

  const runQuery = useCallback(
    async (querySql: string) => {
      if (!querySql.trim()) return
      setRunning(true)
      setResult(null)
      const start = Date.now()
      try {
        const res = await invoke<{
          rows?: Record<string, unknown>[]
          changes?: number
          error?: string
        }>('task-vault:admin:run-query', { sql: querySql })
        const elapsed = Date.now() - start
        if (res.error) {
          setResult({ rows: [], changes: 0, error: res.error, elapsed, sourceSql: querySql })
        } else {
          const isWrite = !res.rows
          setResult({
            rows: res.rows ?? [],
            changes: res.changes ?? 0,
            elapsed,
            sourceSql: querySql,
          })
          void loadStats()
          if (isWrite) onWrite?.()
        }
      } catch (err) {
        setResult({
          rows: [],
          changes: 0,
          error: String(err),
          elapsed: Date.now() - start,
          sourceSql: querySql,
        })
      } finally {
        setRunning(false)
      }
    },
    [loadStats, onWrite]
  )

  const handleRun = () => void runQuery(sql)

  const handleQuickAction = (action: (typeof QUICK_ACTIONS)[number]) => {
    if (action.destructive) {
      setConfirmPending({ title: 'Run destructive query?', sql: action.sql })
    } else {
      setSql(action.sql)
      void runQuery(action.sql)
    }
  }

  const handleConfirm = () => {
    if (!confirmPending) return
    const { sql: pendingSql } = confirmPending
    setSql(pendingSql)
    setConfirmPending(null)
    void runQuery(pendingSql)
  }

  const handleClearTable = (table: string) => {
    setConfirmPending({
      title: `Clear all rows from "${table}"?`,
      sql: `DELETE FROM ${table}`,
    })
  }

  const handleDeleteRow = (row: Record<string, unknown>, table: string) => {
    const id = row['id']
    if (id == null) return
    const idStr = typeof id === 'string' ? `'${id}'` : String(id)
    setConfirmPending({
      title: `Delete row from "${table}"?`,
      sql: `DELETE FROM ${table} WHERE id = ${idStr}`,
    })
  }

  const columns = result?.rows.length ? Object.keys(result.rows[0]) : []
  const sourceTable = result?.sourceSql ? extractTableName(result.sourceSql) : null
  const hasIdColumn = columns.includes('id')
  const canDeleteRows = !!(sourceTable && hasIdColumn)

  return (
    <div className="db-admin">
      {/* Table stats */}
      <div className="db-admin__stats">
        <div className="db-admin__stats-header">
          <span className="db-admin__section-title">Tables</span>
          <IconButton
            icon={RefreshCw}
            label="Refresh tables"
            size="sm"
            onClick={() => void loadStats()}
          />
        </div>
        {stats ? (
          <div className="db-admin__stats-grid">
            {Object.entries(stats).map(([table, count]) => (
              <div key={table} className="db-admin__stat-chip-wrap">
                <div
                  className="db-admin__stat-chip"
                  onClick={() => {
                    const q = `SELECT * FROM ${table} LIMIT 100`
                    setSql(q)
                    void runQuery(q)
                  }}
                  title={`Browse ${table}`}
                >
                  <span className="db-admin__stat-table">{table}</span>
                  <span className="db-admin__stat-count">{count}</span>
                </div>
                <IconButton
                  icon={Trash2}
                  label={`Clear all rows from ${table}`}
                  className="db-admin__stat-clear"
                  size="sm"
                  onClick={() => handleClearTable(table)}
                />
              </div>
            ))}
          </div>
        ) : (
          <span className="db-admin__muted">Loading…</span>
        )}
      </div>

      {/* Quick actions */}
      <div className="db-admin__section">
        <span className="db-admin__section-title">Quick actions</span>
        <div className="db-admin__actions">
          {QUICK_ACTIONS.map((a) => (
            <Button
              key={a.label}
              variant={a.destructive ? 'danger' : 'ghost'}
              size="sm"
              onClick={() => handleQuickAction(a)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* SQL editor */}
      <div className="db-admin__section db-admin__editor-section">
        <span className="db-admin__section-title">SQL</span>
        <div className="db-admin__editor-row">
          <textarea
            ref={textareaRef}
            className="db-admin__editor"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleRun()
              }
            }}
            placeholder="SELECT * FROM tasks LIMIT 50"
            rows={4}
            spellCheck={false}
          />
          <Button
            variant="primary"
            icon={Play}
            onClick={handleRun}
            disabled={running || !sql.trim()}
            title="Run (⌘↵)"
          >
            {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="db-admin__results">
          {result.error ? (
            <div className="db-admin__error">{result.error}</div>
          ) : result.rows.length > 0 ? (
            <>
              <div className="db-admin__result-meta">
                {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}{' '}
                {result.elapsed != null && `· ${result.elapsed}ms`}
                {canDeleteRows && (
                  <span className="db-admin__result-hint">
                    {' · click '}
                    <Trash2
                      className="tm-icon-sm"
                      style={{ display: 'inline', verticalAlign: 'middle' }}
                    />
                    {' to delete a row'}
                  </span>
                )}
              </div>
              <div className="db-admin__table-wrap">
                <table className="db-admin__table">
                  <thead>
                    <tr>
                      {canDeleteRows && <th className="db-admin__action-col" />}
                      {columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="db-admin__data-row">
                        {canDeleteRows && (
                          <td className="db-admin__action-col">
                            <IconButton
                              icon={Trash2}
                              label="Delete this row"
                              className="db-admin__row-delete"
                              size="sm"
                              onClick={() => handleDeleteRow(row, sourceTable!)}
                            />
                          </td>
                        )}
                        {columns.map((c) => (
                          <td key={c}>{String(row[c] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="db-admin__result-meta">
              {result.changes} row{result.changes !== 1 ? 's' : ''} affected
              {result.elapsed != null && ` · ${result.elapsed}ms`}
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmPending && (
        <div className="db-admin__confirm-backdrop" onClick={() => setConfirmPending(null)}>
          <div className="db-admin__confirm" onClick={(e) => e.stopPropagation()}>
            <p className="db-admin__confirm-title">{confirmPending.title}</p>
            <p className="db-admin__confirm-sql">{confirmPending.sql}</p>
            <div className="db-admin__confirm-actions">
              <Button variant="danger" onClick={handleConfirm}>
                Run
              </Button>
              <Button variant="ghost" onClick={() => setConfirmPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
