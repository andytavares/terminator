import { z } from 'zod'
import type { ExtensionDB, ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar } from './register'
import type { SearchResult } from '../db/types'

const searchSchema = z.object({
  query: z.string(),
  includeArchived: z.boolean().optional(),
})

type SearchRow = {
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

/** The notes query for the tag filters and the archive switch; the text is matched after. */
function buildTagQuery(
  includeTags: string[],
  excludeTags: string[],
  includeArchived: boolean
): { sql: string; params: unknown[] } {
  const joins = [
    `LEFT JOIN note_tags nt_all ON nt_all.note_id = n.id`,
    `LEFT JOIN tags t_all ON t_all.id = nt_all.tag_id`,
  ]
  includeTags.forEach((_, i) =>
    joins.push(
      `JOIN note_tags nt_inc${i} ON nt_inc${i}.note_id = n.id`,
      `JOIN tags t_inc${i} ON t_inc${i}.id = nt_inc${i}.tag_id AND LOWER(t_inc${i}.name) = ?`
    )
  )
  const excluded = `NOT EXISTS (SELECT 1 FROM note_tags nx JOIN tags tx ON nx.tag_id = tx.id WHERE nx.note_id = n.id AND LOWER(tx.name) = ?)`
  const conditions = [
    ...(includeArchived ? [] : ['n.archived_at IS NULL']),
    ...excludeTags.map(() => excluded),
  ]
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT n.id, n.title, n.body, n.updated_at, n.archived_at,
            GROUP_CONCAT(t_all.name, ',') AS tags
     FROM notes n
     ${joins.join('\n           ')}
     ${where}
     GROUP BY n.id, n.title, n.body, n.updated_at, n.archived_at
     ORDER BY n.updated_at DESC`
  return { sql, params: [...includeTags, ...excludeTags] }
}

// SQLite's LIKE and LOWER fold ASCII case only (https://www.sqlite.org/lang_expr.html#like),
// so the text is matched here, where toLowerCase folds every script, and % or _ mean themselves.
function containsText(row: SearchRow, textQuery: string): boolean {
  const wanted = textQuery.toLowerCase()
  return row.title.toLowerCase().includes(wanted) || row.body.toLowerCase().includes(wanted)
}

export async function searchNotes(
  db: ExtensionDB,
  args: z.infer<typeof searchSchema>
): Promise<{ data: SearchResult[] } | { error: string }> {
  const { textQuery, includeTags, excludeTags } = parseTagFilters(args.query)
  const { sql, params } = buildTagQuery(includeTags, excludeTags, args.includeArchived ?? false)
  const rows = (await db.query<SearchRow>(sql, params)).filter(
    (row) => !textQuery || containsText(row, textQuery)
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

export function registerSearchIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api)
  handleRemote('terminator.notepad:search.query', searchSchema, (args) => searchNotes(db, args))

  return cleanup
}
