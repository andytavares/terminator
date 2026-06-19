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
  if (!query) return escapeHtml(body.slice(0, 120))

  const words = query
    .replace(/[*"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())

  if (words.length === 0) return escapeHtml(body.slice(0, 120))

  // Find the earliest match in body to center the snippet window
  const bodyLower = body.toLowerCase()
  let anchorIdx = -1
  for (const word of words) {
    const idx = bodyLower.indexOf(word)
    if (idx !== -1 && (anchorIdx === -1 || idx < anchorIdx)) anchorIdx = idx
  }

  const start = anchorIdx === -1 ? 0 : Math.max(0, anchorIdx - 40)
  const end = Math.min(body.length, start + 160)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  const slice = body.slice(start, end)

  // Escape HTML then re-apply mark tags for each query word
  let marked = escapeHtml(slice)
  for (const word of words) {
    marked = marked.replace(new RegExp(`(${escapeRegex(word)})`, 'gi'), '<mark>$1</mark>')
  }

  return `${prefix}${marked}${suffix}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    // FTS5 syntax error fallback — plain-text LIKE search, same tag filters as primary query
    try {
      const fallbackConditions = [...whereConditions]
      const fallbackParams: unknown[] = []
      if (ftsQuery) {
        fallbackConditions.push(`(n.title LIKE ? OR n.body LIKE ?)`)
        fallbackParams.push(`%${ftsQuery}%`, `%${ftsQuery}%`)
      }
      const fallbackWhere =
        fallbackConditions.length > 0 ? `WHERE ${fallbackConditions.join(' AND ')}` : ''
      const rows = db
        .prepare(
          `SELECT n.id, n.title, n.body, n.updated_at, n.archived_at,
                  GROUP_CONCAT(t_all.name, ',') AS tags
           FROM notes n
           ${joinSql}
           ${fallbackWhere}
           GROUP BY n.id
           ORDER BY n.updated_at DESC`
        )
        .all(...joinParams, ...fallbackParams, ...whereParams) as SearchRow[]

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
