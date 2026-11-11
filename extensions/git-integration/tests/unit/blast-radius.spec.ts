import { describe, it, expect } from 'vitest'
import { fileBlastRadius } from '../../src/review/blast-radius'

describe('fileBlastRadius()', () => {
  const results = [
    { name: 'parseToken', path: 'src/token.ts', usedIn: 3, alsoDefinedIn: 1 },
    { name: 'formatToken', path: 'src/token.ts', usedIn: 5, alsoDefinedIn: 0 },
    { name: 'login', path: 'src/login.ts', usedIn: 9, alsoDefinedIn: 2 },
  ]

  it('answers the widest definition of the file', () => {
    expect(fileBlastRadius(results, 'src/token.ts')).toEqual({ usedIn: 5, alsoDefinedIn: 0 })
  })

  it('answers null for a file with no changed definitions', () => {
    expect(fileBlastRadius(results, 'docs/tokens.md')).toBeNull()
  })
})
