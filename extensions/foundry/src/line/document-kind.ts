import type { DocumentHandBack } from '../order/schema.js'

// What an order's document is and what opening it is called. No Node imports:
// the view draws these too.

/** What a handed-back document is, which decides what every surface calls it and how it opens. */
export type DocumentKind = 'claude-artifact' | 'link' | 'file'

// Both forms Claude Code hands out: `/artifact/<id>` from a publish, `/code/artifact/<uuid>` in its docs.
const CLAUDE_ARTIFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]+$/

export function documentKindOf(document: DocumentHandBack): DocumentKind {
  if (document.url === undefined) return 'file'
  return CLAUDE_ARTIFACT.test(document.url) ? 'claude-artifact' : 'link'
}

/** What a surface needs to link to an order's document; none when it lives in the checkout and ships as a pull request. */
export interface DocumentLink {
  readonly kind: DocumentKind
  readonly url: string | null
  readonly path: string
}

/** What the button that opens each kind of document says, on every surface. */
export const OPEN_LABEL: Record<DocumentKind, string> = {
  'claude-artifact': 'Open artifact',
  link: 'Open link',
  file: 'Open document',
}
