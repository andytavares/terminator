import type { CommentAnchor } from './commentField'
import type { Comment } from '../db/types'

export interface ReanchorResult {
  anchor: CommentAnchor
  status: 'ok' | 'orphaned'
  newFrom?: number
  newTo?: number
}

/** The quoted text and the context that pins it to one occurrence. */
interface TextQuote {
  quote: string
  prefix: string
  suffix: string
}

export function reanchorComment(comment: Comment, body: string): ReanchorResult {
  const { startOffset, endOffset, quote, prefix, suffix } = comment

  if (startOffset == null || endOffset == null || !quote) return orphaned(comment)

  // 1. Offset-first: verify quote still matches at the stored offset
  const slice = body.slice(startOffset, endOffset)
  if (slice === quote) {
    return {
      anchor: { id: comment.id, from: startOffset, to: endOffset },
      status: 'ok',
    }
  }

  // 2. Text-quote search fallback
  const candidate = findByTextQuote(body, { quote, prefix: prefix ?? '', suffix: suffix ?? '' })
  if (candidate === null) return orphaned(comment)
  return {
    anchor: { id: comment.id, from: candidate, to: candidate + quote.length },
    status: 'ok',
    newFrom: candidate,
    newTo: candidate + quote.length,
  }
}

function orphaned(comment: Comment): ReanchorResult {
  return { anchor: { id: comment.id, from: 0, to: 0 }, status: 'orphaned' }
}

function findByTextQuote(body: string, textQuote: TextQuote): number | null {
  const { quote, prefix, suffix } = textQuote
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
