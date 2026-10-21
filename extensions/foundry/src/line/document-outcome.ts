import type { DocumentHandBack } from '../order/schema.js'
import type { Recipe } from '../recipe/parse.js'

// How a run ends when its product is a document.
//
// The author says where the document is. In the checkout it is a change like
// any other and ships as a pull request. Anywhere else there is no change, so
// there is nothing to open a pull request on: the run ends on the document.

export type DocumentOutcome =
  | { readonly kind: 'not-a-document-shape' }
  | { readonly kind: 'missing'; readonly reason: string }
  | { readonly kind: 'ready'; readonly where: string }
  | { readonly kind: 'ships' }

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

export function documentLinkOf(order: {
  readonly document: DocumentHandBack | null
}): DocumentLink | null {
  const { document } = order
  if (document === null || document.location === 'checkout') return null
  return { kind: documentKindOf(document), url: document.url ?? null, path: document.path }
}

/** Where a document is, in one line: its place, what it is called, its link. */
export function describeDocument(document: DocumentHandBack): string {
  return `${document.location}: ${document.path}${document.url === undefined ? '' : ` (${document.url})`}`
}

/** What the end of a finished run is, given the shape and what the author handed back. */
export function documentOutcome(
  recipe: Recipe,
  document: DocumentHandBack | null
): DocumentOutcome {
  if (!recipe.steps.some((step) => step.role === 'author')) return { kind: 'not-a-document-shape' }
  if (document === null) return { kind: 'missing', reason: 'the author handed back no document' }
  return document.location === 'checkout'
    ? { kind: 'ships' }
    : { kind: 'ready', where: describeDocument(document) }
}
