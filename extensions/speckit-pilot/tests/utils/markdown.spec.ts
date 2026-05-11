import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/utils/markdown.js'

describe('renderMarkdown()', () => {
  describe('headings', () => {
    it('renders h1', () => {
      expect(renderMarkdown('# Hello')).toBe('<h1>Hello</h1>')
    })

    it('renders h2', () => {
      expect(renderMarkdown('## World')).toBe('<h2>World</h2>')
    })

    it('renders h3–h6', () => {
      expect(renderMarkdown('### Three')).toBe('<h3>Three</h3>')
      expect(renderMarkdown('#### Four')).toBe('<h4>Four</h4>')
      expect(renderMarkdown('##### Five')).toBe('<h5>Five</h5>')
      expect(renderMarkdown('###### Six')).toBe('<h6>Six</h6>')
    })

    it('renders inline formatting inside headings', () => {
      expect(renderMarkdown('## **Bold** heading')).toBe('<h2><strong>Bold</strong> heading</h2>')
    })
  })

  describe('horizontal rule', () => {
    it('renders HR from ---', () => {
      expect(renderMarkdown('---')).toBe('<hr>')
    })

    it('renders HR from ----', () => {
      expect(renderMarkdown('----')).toBe('<hr>')
    })
  })

  describe('blockquote', () => {
    it('renders blockquote', () => {
      expect(renderMarkdown('> A note')).toBe('<blockquote><p>A note</p></blockquote>')
    })
  })

  describe('fenced code block', () => {
    it('renders code block without language', () => {
      const md = '```\nconst x = 1\n```'
      expect(renderMarkdown(md)).toBe('<pre><code>const x = 1</code></pre>')
    })

    it('renders code block with language', () => {
      const md = '```typescript\nconst x: number = 1\n```'
      expect(renderMarkdown(md)).toBe(
        '<pre><code class="language-typescript">const x: number = 1</code></pre>'
      )
    })

    it('escapes HTML inside code blocks', () => {
      const md = '```\n<div>&</div>\n```'
      expect(renderMarkdown(md)).toContain('&lt;div&gt;&amp;&lt;/div&gt;')
    })
  })

  describe('tables', () => {
    it('renders a simple table', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |'
      const result = renderMarkdown(md)
      expect(result).toContain('<table>')
      expect(result).toContain('<th>A</th>')
      expect(result).toContain('<th>B</th>')
      expect(result).toContain('<td>1</td>')
      expect(result).toContain('<td>2</td>')
    })

    it('renders multiple data rows', () => {
      const md = '| X | Y |\n|---|---|\n| a | b |\n| c | d |'
      const result = renderMarkdown(md)
      expect(result).toContain('<td>a</td>')
      expect(result).toContain('<td>c</td>')
    })
  })

  describe('task list', () => {
    it('renders unchecked task item', () => {
      const result = renderMarkdown('- [ ] todo item')
      expect(result).toContain('sk-task-item')
      expect(result).not.toContain('sk-task-item--done')
      expect(result).toContain('todo item')
    })

    it('renders checked task item with lowercase x', () => {
      const result = renderMarkdown('- [x] done item')
      expect(result).toContain('sk-task-item--done')
      expect(result).toContain('checked')
    })

    it('renders checked task item with uppercase X', () => {
      const result = renderMarkdown('- [X] done item')
      expect(result).toContain('sk-task-item--done')
    })

    it('respects indentation via padding-left', () => {
      const result = renderMarkdown('  - [ ] indented')
      expect(result).toContain('padding-left:16px')
    })
  })

  describe('unordered list', () => {
    it('renders single list item', () => {
      const result = renderMarkdown('- item one')
      expect(result).toContain('<ul')
      expect(result).toContain('<li>item one</li>')
    })

    it('renders multiple list items at same indent', () => {
      const result = renderMarkdown('- alpha\n- beta\n- gamma')
      expect(result).toContain('<li>alpha</li>')
      expect(result).toContain('<li>beta</li>')
      expect(result).toContain('<li>gamma</li>')
    })

    it('supports * and + markers', () => {
      expect(renderMarkdown('* star')).toContain('<li>star</li>')
      expect(renderMarkdown('+ plus')).toContain('<li>plus</li>')
    })

    it('stops collecting when indent changes', () => {
      const result = renderMarkdown('- a\n  - nested')
      // Both items rendered but as separate lists due to indent difference
      expect(result).toContain('<li>a</li>')
      expect(result).toContain('<li>nested</li>')
    })
  })

  describe('ordered list', () => {
    it('renders ordered list items', () => {
      const result = renderMarkdown('1. first\n2. second')
      expect(result).toContain('<ol')
      expect(result).toContain('<li>first</li>')
      expect(result).toContain('<li>second</li>')
    })

    it('stops at non-list line', () => {
      const result = renderMarkdown('1. only\n\nnext para')
      expect(result).toContain('<li>only</li>')
      expect(result).toContain('<p>next para</p>')
    })
  })

  describe('paragraphs', () => {
    it('wraps plain text in <p>', () => {
      expect(renderMarkdown('Hello world')).toBe('<p>Hello world</p>')
    })
  })

  describe('blank lines', () => {
    it('skips blank lines without output', () => {
      const result = renderMarkdown('line1\n\nline2')
      expect(result).toBe('<p>line1</p>\n<p>line2</p>')
    })
  })

  describe('inline formatting', () => {
    it('renders bold', () => {
      expect(renderMarkdown('**bold**')).toBe('<p><strong>bold</strong></p>')
    })

    it('renders italic', () => {
      expect(renderMarkdown('*italic*')).toBe('<p><em>italic</em></p>')
    })

    it('renders inline code', () => {
      expect(renderMarkdown('use `foo()` here')).toBe('<p>use <code>foo()</code> here</p>')
    })

    it('renders links', () => {
      expect(renderMarkdown('[click](https://example.com)')).toBe(
        '<p><a href="https://example.com">click</a></p>'
      )
    })

    it('escapes HTML entities', () => {
      expect(renderMarkdown('a < b & c > d')).toBe('<p>a &lt; b &amp; c &gt; d</p>')
    })
  })

  describe('empty input', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdown('')).toBe('')
    })
  })
})
