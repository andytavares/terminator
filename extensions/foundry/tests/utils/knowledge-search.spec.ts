import { describe, it, expect } from 'vitest'
import { parseRgLines, searchFiles } from '../../src/utils/knowledge-search.js'

describe('parseRgLines', () => {
  it('parses path:line:snippet lines', () => {
    const out = 'docs/ARCHITECTURE.md:12:Auth lives here\nspecs/001/spec.md:3:  auth flow  '
    const refs = parseRgLines(out)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({ file: 'docs/ARCHITECTURE.md', line: 12, snippet: 'Auth lives here' })
    expect(refs[1].snippet).toBe('auth flow')
  })

  it('skips malformed lines and blanks', () => {
    expect(parseRgLines('no-colon-line\n\nfile.md:notanumber:x')).toEqual([])
  })

  it('respects the limit', () => {
    const out = Array.from({ length: 10 }, (_, i) => `f.md:${i + 1}:hit`).join('\n')
    expect(parseRgLines(out, 3)).toHaveLength(3)
  })
})

describe('searchFiles', () => {
  const files = [
    { file: 'a.md', content: 'First line\nHas Auth token\nnothing here' },
    { file: 'b.md', content: 'AUTHENTICATION flow\nplain' },
  ]

  it('finds case-insensitive matches with 1-indexed lines', () => {
    const refs = searchFiles(files, 'auth')
    expect(refs).toEqual([
      { file: 'a.md', line: 2, snippet: 'Has Auth token' },
      { file: 'b.md', line: 1, snippet: 'AUTHENTICATION flow' },
    ])
  })

  it('returns empty for a blank query', () => {
    expect(searchFiles(files, '   ')).toEqual([])
  })

  it('returns empty when nothing matches', () => {
    expect(searchFiles(files, 'zzz')).toEqual([])
  })

  it('respects the limit', () => {
    const many = [{ file: 'm.md', content: 'x\nx\nx\nx' }]
    expect(searchFiles(many, 'x', 2)).toHaveLength(2)
  })
})
