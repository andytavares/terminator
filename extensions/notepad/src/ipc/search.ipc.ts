import { ipcMain } from 'electron'
import { z } from 'zod'
import { getDb } from '../db/db'
import type { SearchResult } from '../db/types'

const searchSchema = z.object({
  query: z.string(),
  includeArchived: z.boolean().optional(),
})

interface SearchRow {
  id: string
  title: string
  body: string
  updated_at: string
  archived_at: string | null
  tags: string | null
}

function parseTagFilters(query: string): {
  ftsQuery: string
  includeTags: string[]
  excludeTags: string[]
} {
  const includeTags: string[] = []
  const excludeTags: string[] = []

  const cleaned = query
    .replace(/-tag:([a-z0-9_-]+)/gi, (_, t) => {
      excludeTags.push(t.toLowerCase())
      return ''
    })
    .replace(/tag:([a-z0-9_-]+)/gi, (_, t) => {
      includeTags.push(t.toLowerCase())
      return ''
    })
    .trim()

  return { ftsQuery: cleaned, includeTags, excludeTags }
}

function makeSnippet(body: string, query: string): string {
  if (!query) return body.slice(0, 120)
  const word = query.replace(/[*"]/g, '').split(/\s+/)[0]
  if (!word) return body.slice(0, 120)
  const idx = body.toLowerCase().indexOf(word.toLowerCase())
  if (idx === -1) return body.slice(0, 120)
  const start = Math.max(0, idx - 40)
  const end = Math.min(body.length, idx + 80)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  const slice = body.slice(start, end)
  const marked = slice.replace(new RegExp(`(${word})`, 'gi'), '<mark>$1</mark>')
  return `${prefix}${marked}${suffix}`
}

export async function searchNotes(
  payload: unknown
): Promise<{ data: SearchResult[] } | { error: string }> {
  const parsed = searchSchema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const { query, includeArchived = false } = parsed.data
  const { ftsQuery, includeTags, excludeTags } = parseTagFilters(query)

  const db = getDb()

  // Params for JOIN ON clauses (include tags)
  const joinParams: unknown[] = []
  // Params for WHERE clauses (archived + exclude tags)
  const whereParams: unknown[] = []

  const whereConditions: string[] = []
  const joinClauses: string[] = [
    `LEFT JOIN note_tags nt_all ON nt_all.note_id = n.id`,
    `LEFT JOIN tags t_all ON t_all.id = nt_all.tag_id`,
  ]

  if (!includeArchived) {
    whereConditions.push('n.archived_at IS NULL')
  }

  // Include-tag: INNER JOIN filters to notes with all required tags
  for (let i = 0; i < includeTags.length; i++) {
    const na = `nt_inc${i}`
    const ta = `t_inc${i}`
    joinClauses.push(
      `JOIN note_tags ${na} ON ${na}.note_id = n.id`,
      `JOIN tags ${ta} ON ${ta}.id = ${na}.tag_id AND LOWER(${ta}.name) = ?`
    )
    joinParams.push(includeTags[i])
  }

  // Exclude-tag: WHERE NOT EXISTS
  for (const tag of excludeTags) {
    whereConditions.push(
      `NOT EXISTS (SELECT 1 FROM note_tags nx JOIN tags tx ON nx.tag_id = tx.id WHERE nx.note_id = n.id AND LOWER(tx.name) = ?)`
    )
    whereParams.push(tag)
  }

  const joinSql = joinClauses.join('\n           ')
  const whereSql = whereConditions.length > 0 ? `AND ${whereConditions.join(' AND ')}` : ''

  const toResults = (rows: SearchRow[]): SearchResult[] =>
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: makeSnippet(r.body, ftsQuery),
      tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
    }))

  try {
    let rows: SearchRow[]

    if (ftsQuery) {
      // FTS5 subquery captures rowid + rank; outer query joins notes + tag filters
      // Param order: joinParams (JOIN ON ?), ftsQuery (subquery MATCH ?), whereParams (NOT EXISTS ?)
      rows = db
        .prepare(
          `SELECT n.id, n.title, n.body, n.updated_at, n.archived_at,
                  GROUP_CONCAT(t_all.name, ',') AS tags
           FROM notes n
           ${joinSql}
           JOIN (SELECT rowid, rank FROM notes_fts WHERE notes_fts MATCH ?) fts ON fts.rowid = n.rowid
           WHERE 1=1 ${whereSql}
           GROUP BY n.id
           ORDER BY fts.rank`
        )
        .all(...joinParams, ftsQuery, ...whereParams) as SearchRow[]
    } else {
      const conds = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''
      rows = db
        .prepare(
          `SELECT n.id, n.title, n.body, n.updated_at, n.archived_at,
                  GROUP_CONCAT(t_all.name, ',') AS tags
           FROM notes n
           ${joinSql}
           ${conds}
           GROUP BY n.id
           ORDER BY n.updated_at DESC`
        )
        .all(...joinParams, ...whereParams) as SearchRow[]
    }

    return { data: toResults(rows) }
  } catch {
    // FTS5 syntax error fallback — plain-text LIKE search
    try {
      const conditions2: string[] = []
      const params2: unknown[] = []
      if (ftsQuery) {
        conditions2.push(`(n.title LIKE ? OR n.body LIKE ?)`)
        params2.push(`%${ftsQuery}%`, `%${ftsQuery}%`)
      }
      if (!includeArchived) conditions2.push('n.archived_at IS NULL')

      const fallbackWhere = conditions2.length > 0 ? `WHERE ${conditions2.join(' AND ')}` : ''
      const rows = db
        .prepare(
          `SELECT n.id, n.title, n.body, n.updated_at, n.archived_at,
                  GROUP_CONCAT(t.name, ',') AS tags
           FROM notes n
           LEFT JOIN note_tags nt ON nt.note_id = n.id
           LEFT JOIN tags t ON t.id = nt.tag_id
           ${fallbackWhere}
           GROUP BY n.id
           ORDER BY n.updated_at DESC`
        )
        .all(...params2) as SearchRow[]

      return { data: toResults(rows) }
    } catch {
      return { data: [] }
    }
  }
}

export function registerSearchIpcHandlers(): () => void {
  ipcMain.handle('terminator.notepad:search.query', (_evt, payload: unknown) =>
    searchNotes(payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:search.query')
  }
}
