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
