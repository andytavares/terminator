import type { CommentAnchor } from './commentField'
import type { Comment } from '../db/types'

export interface ReanchorResult {
  anchor: CommentAnchor
  status: 'ok' | 'orphaned'
  newFrom?: number
  newTo?: number
}

const orphaned = (id: string): ReanchorResult => ({
  anchor: { id, from: 0, to: 0 },
  status: 'orphaned',
})

export function reanchorComment(comment: Comment, body: string): ReanchorResult {
  const { startOffset, endOffset, quote, prefix, suffix } = comment
  if (startOffset == null || endOffset == null || !quote) return orphaned(comment.id)

  // 1. Offset-first: verify quote still matches at the stored offset
  if (body.slice(startOffset, endOffset) === quote) {
    return { anchor: { id: comment.id, from: startOffset, to: endOffset }, status: 'ok' }
  }

  // 2. Text-quote search fallback
  // The context only disambiguates (W3C TextQuoteSelector,
  // https://www.w3.org/TR/annotation-model/#text-quote-selector): an edit inside
  // it must not orphan a quote that is still there.
  const from =
    findByTextQuote(body, quote, prefix ?? '', suffix ?? '') ??
    nearestOccurrence(body, quote, startOffset)
  if (from === null) return orphaned(comment.id)
  const to = from + quote.length
  return { anchor: { id: comment.id, from, to }, status: 'ok', newFrom: from, newTo: to }
}

function findByTextQuote(
  body: string,
  quote: string,
  prefix: string,
  suffix: string
): number | null {
  let idx = body.indexOf(quote)
  while (idx !== -1) {
    const before = body.slice(Math.max(0, idx - prefix.length), idx)
    const after = body.slice(idx + quote.length, idx + quote.length + suffix.length)
    if (before.endsWith(prefix) && after.startsWith(suffix)) {
      return idx
    }
    idx = body.indexOf(quote, idx + 1)
  }
  return null
}

function nearestOccurrence(body: string, quote: string, oldOffset: number): number | null {
  let nearest: number | null = null
  for (let idx = body.indexOf(quote); idx !== -1; idx = body.indexOf(quote, idx + 1)) {
    if (nearest === null || Math.abs(idx - oldOffset) < Math.abs(nearest - oldOffset)) nearest = idx
  }
  return nearest
}
