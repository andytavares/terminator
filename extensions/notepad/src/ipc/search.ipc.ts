import { ipcMain } from 'electron'
import { z } from 'zod'
import type { ExtensionDB } from '../../../../src/main/db/index'
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
  textQuery: string
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

  return { textQuery: cleaned, includeTags, excludeTags }
}

function makeSnippet(body: string, query: string): string {
  if (!query) return escapeHtml(body.slice(0, 120))

  const words = query
    .replace(/[*"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())

  if (words.length === 0) return escapeHtml(body.slice(0, 120))

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
  db: ExtensionDB,
  payload: unknown
): Promise<{ data: SearchResult[] } | { error: string }> {
  const parsed = searchSchema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const { query, includeArchived = false } = parsed.data
  const { textQuery, includeTags, excludeTags } = parseTagFilters(query)

  const joinParams: unknown[] = []
  const whereParams: unknown[] = []
  const whereConditions: string[] = []

  const joinClauses: string[] = [
    `LEFT JOIN note_tags nt_all ON nt_all.note_id = n.id`,
    `LEFT JOIN tags t_all ON t_all.id = nt_all.tag_id`,
  ]

  if (!includeArchived) {
    whereConditions.push('n.archived_at IS NULL')
  }

  if (textQuery) {
    // ILIKE replaces FTS5; full sequential scan on large sets — see ADR-019 for upgrade path.
    whereConditions.push(`(n.title ILIKE ? OR n.body ILIKE ?)`)
    whereParams.push(`%${textQuery}%`, `%${textQuery}%`)
  }

  for (let i = 0; i < includeTags.length; i++) {
    const na = `nt_inc${i}`
    const ta = `t_inc${i}`
    joinClauses.push(
      `JOIN note_tags ${na} ON ${na}.note_id = n.id`,
      `JOIN tags ${ta} ON ${ta}.id = ${na}.tag_id AND LOWER(${ta}.name) = ?`
    )
    joinParams.push(includeTags[i])
  }

  for (const tag of excludeTags) {
    whereConditions.push(
      `NOT EXISTS (SELECT 1 FROM note_tags nx JOIN tags tx ON nx.tag_id = tx.id WHERE nx.note_id = n.id AND LOWER(tx.name) = ?)`
    )
    whereParams.push(tag)
  }

  const joinSql = joinClauses.join('\n           ')
  const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

  const rows = await db.query<SearchRow>(
    `SELECT n.id, n.title, n.body, n.updated_at, n.archived_at,
            STRING_AGG(t_all.name, ',') AS tags
     FROM notes n
     ${joinSql}
     ${whereSql}
     GROUP BY n.id, n.title, n.body, n.updated_at, n.archived_at
     ORDER BY n.updated_at DESC`,
    [...joinParams, ...whereParams]
  )

  const data: SearchResult[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: makeSnippet(r.body, textQuery),
    tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  }))

  return { data }
}

export function registerSearchIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:search.query', (_evt, payload: unknown) =>
    searchNotes(db, payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:search.query')
  }
}
