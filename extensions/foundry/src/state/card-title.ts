/**
 * What a card is called on the board.
 *
 * Backlog cards carried human sentences while the Done column showed folder
 * slugs — `001-extension-isolation`, `004-speckit-pilot` — because a card
 * created from a directory takes its brief title from the directory name. The
 * same board named the same kind of object two different ways.
 *
 * This does not rewrite anything stored. It is a display rule: a title that is
 * still a slug is presented as prose, and anything a person actually wrote is
 * left exactly as they wrote it.
 */

/** `001-extension-isolation`, `20260905-143022-fix-thing`, `fix/sidebar-sorting`. */
const SLUG = /^(?:\d{3,}-|\d{8}-\d{6}-)?[a-z0-9]+(?:[-/][a-z0-9]+)*$/

export function displayTitle(title: string, featureDir?: string): string {
  const trimmed = title.trim()
  if (trimmed === '') return humanise(lastSegment(featureDir ?? '')) || 'Untitled card'
  if (!SLUG.test(trimmed)) return trimmed
  return humanise(trimmed)
}

/**
 * Turn a slug into a sentence.
 *
 * Only ever applied to something that already matched SLUG, so it cannot
 * mangle a real title — a sentence contains spaces or capitals and never
 * reaches here.
 */
function humanise(slug: string): string {
  const words = slug
    .replace(/^\d{8}-\d{6}-/, '')
    .replace(/^\d{3,}-/, '')
    .split(/[-/]/)
    .filter(Boolean)
  if (words.length === 0) return ''
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

function lastSegment(dir: string): string {
  const parts = dir.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
