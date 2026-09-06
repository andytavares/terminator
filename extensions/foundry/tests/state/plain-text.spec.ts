import { describe, it, expect } from 'vitest'
import { firstProseLine } from '../../src/state/plain-text'

// The literal string "# Summary" was the description on every card on the board,
// and again in the drawer's Scope field.

describe('firstProseLine', () => {
  it('skips a heading and takes the prose under it', () => {
    expect(firstProseLine('# Summary\nMake all text in the application red')).toBe(
      'Make all text in the application red'
    )
  })

  it('skips several headings and blank lines', () => {
    expect(firstProseLine('# Summary\n\n## Detail\n\nEvery surface reads one token.')).toBe(
      'Every surface reads one token.'
    )
  })

  it('returns nothing for a brief that is only headings', () => {
    expect(firstProseLine('# Summary\n## Detail\n### More')).toBe('')
  })

  it('handles an empty brief', () => {
    expect(firstProseLine('')).toBe('')
    expect(firstProseLine(null)).toBe('')
    expect(firstProseLine(undefined)).toBe('')
  })

  // The whole block, not just its delimiters: the first line inside a fence
  // would otherwise become the card's summary.
  it('skips a fenced code block entirely', () => {
    expect(firstProseLine('```ts\nconst a = 1\n```\nThe real sentence.')).toBe('The real sentence.')
  })

  it('returns nothing when an unclosed fence swallows the rest', () => {
    expect(firstProseLine('```\nconst a = 1')).toBe('')
  })

  it('skips a horizontal rule', () => {
    expect(firstProseLine('---\nAfter the rule.')).toBe('After the rule.')
  })

  it('takes the text of a list item', () => {
    expect(firstProseLine('# Summary\n- The first real point')).toBe('The first real point')
  })

  describe('inline markers', () => {
    it.each([
      ['**bold** text', 'bold text'],
      ['`code` text', 'code text'],
      ['a _stressed_ word', 'a stressed word'],
      ['a *starred* word', 'a starred word'],
      ['see [the docs](https://x.dev)', 'see the docs'],
      ['![a diagram](x.png) follows', 'a diagram follows'],
      ['> quoted line', 'quoted line'],
    ])('renders %s as plain text', (input, expected) => {
      expect(firstProseLine(input)).toBe(expected)
    })

    it('leaves an underscore inside a word alone', () => {
      expect(firstProseLine('use snake_case names')).toBe('use snake_case names')
    })
  })
})
