import { describe, it, expect } from 'vitest'
import {
  describeDocument,
  documentKindOf,
  documentOutcome,
} from '../../src/line/document-outcome.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'

// A shape whose product is a document ends on where the author put it, not on a
// pull request every time. WO-0913-0bd's research order pushed the base commit
// and failed with "No commits between"; the document was the answer and had
// nowhere to go.

function recipe(role: string): Recipe {
  const parsed = parseRecipe(
    `schemaVersion: 1\nid: direct\nsteps:\n  - id: write\n    kind: agent\n    role: ${role}\n`,
    'direct.yaml'
  )
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

describe('documentOutcome', () => {
  describe('shapes without a document', shapesWithoutADocumentTests)
  describe('where the document is', whereTheDocumentIsTests)
})

function shapesWithoutADocumentTests() {
  it('leaves a shape with no author alone, whatever the order holds', () => {
    expect(documentOutcome(recipe('builder'), null)).toEqual({ kind: 'not-a-document-shape' })
    expect(documentOutcome(recipe('builder'), { path: 'a.md', location: 'outputs' })).toEqual({
      kind: 'not-a-document-shape',
    })
  })

  it('fails an author that handed back no document, in those words', () => {
    expect(documentOutcome(recipe('author'), null)).toEqual({
      kind: 'missing',
      reason: 'the author handed back no document',
    })
  })
}

function whereTheDocumentIsTests() {
  it('ends on the document when it is outside the checkout', () => {
    expect(
      documentOutcome(recipe('author'), { path: '/o/answer.md', location: 'outputs' })
    ).toEqual({ kind: 'ready', where: 'outputs: /o/answer.md' })
    expect(
      documentOutcome(recipe('author'), {
        path: 'Quarterly notes',
        url: 'https://example.com/d/1',
        location: 'published',
      })
    ).toEqual({ kind: 'ready', where: 'published: Quarterly notes (https://example.com/d/1)' })
  })

  it('ships a document that is in the checkout as a pull request', () => {
    expect(
      documentOutcome(recipe('author'), { path: 'docs/answer.md', location: 'checkout' })
    ).toEqual({ kind: 'ships' })
  })
}

describe('describeDocument', () => {
  it('says where, then what, then the link when there is one', () => {
    expect(describeDocument({ path: 'docs/a.md', location: 'checkout' })).toBe(
      'checkout: docs/a.md'
    )
    expect(describeDocument({ path: 'x', url: 'https://e.com', location: 'published' })).toBe(
      'published: x (https://e.com)'
    )
  })
})

describe('documentKindOf', () => {
  it('names a claude.ai artifact link in either of its forms', () => {
    for (const url of [
      'https://claude.ai/artifact/YJeSCmFWK1GJC8X9ZXUpVf',
      'https://claude.ai/code/artifact/5fbea6f3-2c1d-4b8e-9a77-0d4e2b6c1f20',
    ]) {
      expect(documentKindOf({ path: '/o/doc.html', url, location: 'published' })).toBe(
        'claude-artifact'
      )
    }
  })

  it('calls any other published link a link, and a document without one a file', () => {
    const elsewhere = 'https://claude.ai.example.com/artifact/abc'
    expect(documentKindOf({ path: 'a.md', url: elsewhere, location: 'published' })).toBe('link')
    expect(documentKindOf({ path: '/o/a.md', location: 'outputs' })).toBe('file')
    expect(documentKindOf({ path: 'docs/a.md', location: 'checkout' })).toBe('file')
  })
})
