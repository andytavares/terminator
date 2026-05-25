import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/utils/markdown'

describe('renderMarkdown', () => {
  it('returns empty string for blank input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).toBe('')
  })

  it('renders h1, h2, h3 headers', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('## Section')).toContain('<h2>Section</h2>')
    expect(renderMarkdown('### Sub')).toContain('<h3>Sub</h3>')
  })

  it('renders bold and italic inline', () => {
    const out = renderMarkdown('**bold** and *italic*')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
  })

  it('renders inline code', () => {
    const out = renderMarkdown('use `npm install`')
    expect(out).toContain('<code>npm install</code>')
  })

  it('renders fenced code block', () => {
    const out = renderMarkdown('```\nconst x = 1\n```')
    expect(out).toContain('<pre><code>')
    expect(out).toContain('const x = 1')
  })

  it('renders unordered bullet list', () => {
    const out = renderMarkdown('- item one\n- item two')
    expect(out).toContain('<ul>')
    expect(out).toContain('<li>item one</li>')
    expect(out).toContain('<li>item two</li>')
    expect(out).toContain('</ul>')
  })

  it('renders unchecked checkbox items', () => {
    const out = renderMarkdown('- [ ] do this')
    expect(out).toContain('md-check')
    expect(out).toContain('do this')
    expect(out).not.toContain('md-check--done')
  })

  it('renders checked checkbox items with done class', () => {
    const out = renderMarkdown('- [x] done this')
    expect(out).toContain('md-check--done')
    expect(out).toContain('done this')
  })

  it('renders plain text as paragraph', () => {
    const out = renderMarkdown('Hello world')
    expect(out).toContain('<p>')
    expect(out).toContain('Hello world')
  })

  it('escapes HTML special characters', () => {
    const out = renderMarkdown('a < b & c > d')
    expect(out).toContain('&lt;')
    expect(out).toContain('&gt;')
    expect(out).toContain('&amp;')
    expect(out).not.toContain('<b')
  })

  it('closes list before paragraph', () => {
    const out = renderMarkdown('- item\n\nParagraph')
    const listEnd = out.indexOf('</ul>')
    const paraStart = out.indexOf('<p>Paragraph')
    expect(listEnd).toBeGreaterThan(-1)
    expect(paraStart).toBeGreaterThan(listEnd)
  })

  it('renders markdown links as anchor tags', () => {
    const out = renderMarkdown('[Click here](https://example.com)')
    expect(out).toContain('<a href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('Click here</a>')
  })

  it('does not render non-http links (security)', () => {
    const out = renderMarkdown('[bad](javascript:alert(1))')
    expect(out).not.toContain('<a href="javascript')
  })

  it('renders multiple sections without interference', () => {
    const md = '# Title\n\nSome text\n\n- bullet\n\n## Sub\n\nMore text'
    const out = renderMarkdown(md)
    expect(out).toContain('<h1>Title</h1>')
    expect(out).toContain('<h2>Sub</h2>')
    expect(out).toContain('<li>bullet</li>')
  })
})
