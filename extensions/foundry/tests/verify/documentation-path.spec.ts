import { describe, it, expect } from 'vitest'
import { isDocumentationRelative } from '../../src/verify/documentation-path.js'

describe('isDocumentationRelative', () => {
  it.each([
    'README.md',
    'docs/adr/085.md',
    'docs/diagram.svg',
    'specs/054/plan.md',
    'CHANGELOG',
    'a/b/notes.MD',
    './README',
  ])('counts %s as documentation', (file) => expect(isDocumentationRelative(file)).toBe(true))

  it.each([
    'src/index.ts',
    'docs',
    'package.json',
    '../other/README.md',
    '/abs/docs/x.md',
    'tests/docs/x.ts',
  ])('does not count %s', (file) => expect(isDocumentationRelative(file)).toBe(false))
})
