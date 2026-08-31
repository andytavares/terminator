import { describe, it, expect } from 'vitest'
import { parseOutline } from '../../../src/editor/outline'

describe('parseOutline', () => {
  it('returns nothing for a body with no headings', () => {
    expect(parseOutline('just some prose\nand more of it')).toEqual([])
  })

  it('reads the level from the number of hashes', () => {
    const body = '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six'
    expect(parseOutline(body).map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('strips the marker from the text', () => {
    expect(parseOutline('## Getting started')[0].text).toBe('Getting started')
  })

  it('strips a closing hash sequence, which is decoration not text', () => {
    expect(parseOutline('## Getting started ##')[0].text).toBe('Getting started')
  })

  it('reports the offset of the line start, so a jump lands on the heading', () => {
    const body = 'intro\n\n## Second\n'
    expect(parseOutline(body)[0].from).toBe(body.indexOf('## Second'))
  })

  it('ignores seven hashes — that is not a heading', () => {
    expect(parseOutline('####### Nope')).toEqual([])
  })

  it('ignores a hash run with no space after it', () => {
    expect(parseOutline('#NotAHeading')).toEqual([])
  })

  it('allows up to three leading spaces', () => {
    expect(parseOutline('   ### Indented')).toHaveLength(1)
  })

  it('ignores four leading spaces — that is an indented code block', () => {
    expect(parseOutline('    ### Code')).toEqual([])
  })

  it('skips headings inside a backtick fence', () => {
    const body = '# Real\n\n```md\n# Fake\n```\n\n## Also real'
    expect(parseOutline(body).map((h) => h.text)).toEqual(['Real', 'Also real'])
  })

  it('skips headings inside a tilde fence', () => {
    const body = '~~~\n# Fake\n~~~\n# Real'
    expect(parseOutline(body).map((h) => h.text)).toEqual(['Real'])
  })

  it('keeps skipping when a fence is never closed', () => {
    expect(parseOutline('```\n# Fake\n# Also fake')).toEqual([])
  })

  it('does not let a tilde line close a backtick fence', () => {
    expect(parseOutline('```\n~~~\n# Fake\n```\n# Real').map((h) => h.text)).toEqual(['Real'])
  })

  it('needs the closing fence to be at least as long as the opening one', () => {
    const body = '````\n```\n# Fake\n````\n# Real'
    expect(parseOutline(body).map((h) => h.text)).toEqual(['Real'])
  })

  it('drops a heading with no text — an outline entry with no label says nothing', () => {
    expect(parseOutline('##\n## Real').map((h) => h.text)).toEqual(['Real'])
  })

  it('drops a heading that is only a closing sequence', () => {
    expect(parseOutline('## ##')).toEqual([])
  })
})
