import { describe, it, expect } from 'vitest'
import { parseFrontMatter, stringifyFrontMatter } from '../../../src/ipc/front-matter'

// Replaces gray-matter, which has not been released since 2018 and held js-yaml
// at a version with a published denial-of-service advisory that npm `overrides`
// could not reach inside a workspace. What it replaces is small and entirely
// specified by the format the exporter writes in the first place.

describe('parseFrontMatter', () => {
  it('reads the YAML header and returns the body separately', () => {
    expect(parseFrontMatter('---\nid: abc\ntitle: Note\n---\nThe body\n')).toEqual({
      data: { id: 'abc', title: 'Note' },
      content: 'The body\n',
    })
  })

  it('keeps types rather than returning everything as strings', () => {
    const { data } = parseFrontMatter('---\ncount: 3\ndone: true\ntags:\n  - a\n  - b\n---\nx')
    expect(data).toEqual({ count: 3, done: true, tags: ['a', 'b'] })
  })

  it('treats a file with no header as all body', () => {
    expect(parseFrontMatter('Just a note')).toEqual({ data: {}, content: 'Just a note' })
  })

  it('does not mistake a horizontal rule further down for a header', () => {
    // `---` mid-document is markdown, and reading it as front matter would
    // swallow everything above it.
    const input = 'Some text\n\n---\n\nMore text'
    expect(parseFrontMatter(input)).toEqual({ data: {}, content: input })
  })

  it('reads a header with no body after it', () => {
    expect(parseFrontMatter('---\nid: abc\n---')).toEqual({ data: { id: 'abc' }, content: '' })
  })

  it('survives CRLF, because these files come back from other tools', () => {
    expect(parseFrontMatter('---\r\nid: abc\r\n---\r\nbody')).toEqual({
      data: { id: 'abc' },
      content: 'body',
    })
  })

  it('keeps the body when the YAML is malformed, rather than losing the note', () => {
    const { data, content } = parseFrontMatter('---\nid: [unclosed\n---\nstill readable')
    expect(data).toEqual({})
    expect(content).toBe('still readable')
  })

  it('ignores a header that is not a mapping — there are no fields to read', () => {
    expect(parseFrontMatter('---\njust a string\n---\nbody').data).toEqual({})
  })

  it('ignores a header that is a list', () => {
    expect(parseFrontMatter('---\n- one\n- two\n---\nbody').data).toEqual({})
  })

  it('returns nothing for an empty file', () => {
    expect(parseFrontMatter('')).toEqual({ data: {}, content: '' })
  })

  it('returns nothing for something that is not a string', () => {
    expect(parseFrontMatter(null as unknown as string)).toEqual({ data: {}, content: '' })
  })

  it('does not execute code in a header, however the note got onto disk', () => {
    // js-yaml 3's `load` resolves `!!js/function` and builds a real function
    // from the body — gray-matter avoided it by calling `safeLoad`. On 4 the
    // safe schema is the default and the tag is simply refused. Notes are
    // imported from a folder the operator points at, so this is reachable by
    // anything that can write a file there.
    const evil = '---\nrun: !!js/function >\n  function(){ return 42 }\n---\nbody'
    const { data, content } = parseFrontMatter(evil)
    expect(typeof (data as { run?: unknown }).run).not.toBe('function')
    expect(content).toBe('body')
  })

  it('refuses a header that reaches for another file', () => {
    const { data } = parseFrontMatter('---\nid: !!js/undefined ~\n---\nbody')
    expect(data).toEqual({})
  })
})

describe('stringifyFrontMatter', () => {
  it('writes a header the parser reads back', () => {
    const data = { id: 'abc', title: 'A note', tags: ['x'] }
    expect(parseFrontMatter(stringifyFrontMatter('body text', data))).toEqual({
      data,
      content: 'body text',
    })
  })

  it('opens and closes with the delimiter', () => {
    const out = stringifyFrontMatter('body', { id: 'a' })
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('\n---\n')
  })

  it('does not fold a long title across lines', () => {
    // Valid YAML either way, but unreadable in a file the operator opens by
    // hand — which is the whole reason these are exported as markdown.
    const title = 'A '.repeat(80).trim()
    expect(stringifyFrontMatter('body', { title })).toContain(title)
  })

  it('round-trips an empty body', () => {
    expect(parseFrontMatter(stringifyFrontMatter('', { id: 'a' })).content).toBe('')
  })
})
