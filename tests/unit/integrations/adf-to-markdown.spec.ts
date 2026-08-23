import { describe, it, expect } from 'vitest'
import { adfToMarkdown } from '../../../src/main/integrations/adf-to-markdown'

/** Wrap nodes in a minimal ADF document. */
function doc(...content: unknown[]): unknown {
  return { type: 'doc', version: 1, content }
}
function text(value: string, marks?: unknown[]): unknown {
  return marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks }
}
function para(...content: unknown[]): unknown {
  return { type: 'paragraph', content }
}

describe('adfToMarkdown — block nodes', () => {
  it('renders headings at their level', () => {
    const out = adfToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('One')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Three')] }
      )
    )
    expect(out).toContain('# One')
    expect(out).toContain('### Three')
  })

  it('separates paragraphs with a blank line', () => {
    expect(adfToMarkdown(doc(para(text('first')), para(text('second'))))).toBe('first\n\nsecond')
  })

  it('renders a bullet list', () => {
    const out = adfToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para(text('alpha'))] },
          { type: 'listItem', content: [para(text('beta'))] },
        ],
      })
    )
    expect(out).toBe('- alpha\n- beta')
  })

  it('renders an ordered list with ascending numbers', () => {
    const out = adfToMarkdown(
      doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [para(text('one'))] },
          { type: 'listItem', content: [para(text('two'))] },
        ],
      })
    )
    expect(out).toBe('1. one\n2. two')
  })

  it('nests a list inside a list item', () => {
    const out = adfToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              para(text('outer')),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [para(text('inner'))] }],
              },
            ],
          },
        ],
      })
    )
    expect(out).toBe('- outer\n  - inner')
  })

  it('renders a task list as checkboxes, honouring state', () => {
    const out = adfToMarkdown(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { state: 'DONE' }, content: [text('done thing')] },
          { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('todo thing')] },
        ],
      })
    )
    expect(out).toBe('- [x] done thing\n- [ ] todo thing')
  })

  it('renders a table with a header separator', () => {
    const cell = (t: string, type: 'tableHeader' | 'tableCell'): unknown => ({
      type,
      content: [para(text(t))],
    })
    const out = adfToMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [cell('Name', 'tableHeader'), cell('Value', 'tableHeader')],
          },
          { type: 'tableRow', content: [cell('a', 'tableCell'), cell('1', 'tableCell')] },
        ],
      })
    )
    expect(out).toBe('| Name | Value |\n| --- | --- |\n| a | 1 |')
  })

  it('renders a blockquote with a marker on every line', () => {
    const out = adfToMarkdown(
      doc({ type: 'blockquote', content: [para(text('line one')), para(text('line two'))] })
    )
    expect(out).toBe('> line one\n>\n> line two')
  })

  it('renders a fenced code block carrying its language', () => {
    const out = adfToMarkdown(
      doc({ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1')] })
    )
    expect(out).toBe('```ts\nconst a = 1\n```')
  })

  it('renders a code block with no language as a bare fence', () => {
    const out = adfToMarkdown(doc({ type: 'codeBlock', content: [text('plain')] }))
    expect(out).toBe('```\nplain\n```')
  })

  it('renders a rule', () => {
    expect(adfToMarkdown(doc(para(text('a')), { type: 'rule' }, para(text('b'))))).toBe(
      'a\n\n---\n\nb'
    )
  })

  it('renders a hard break as a line break inside a paragraph', () => {
    expect(adfToMarkdown(doc(para(text('a'), { type: 'hardBreak' }, text('b'))))).toBe('a\nb')
  })
})

describe('adfToMarkdown — marks', () => {
  it.each([
    [[{ type: 'strong' }], '**bold**'],
    [[{ type: 'em' }], '_bold_'],
    [[{ type: 'code' }], '`bold`'],
    [[{ type: 'strike' }], '~~bold~~'],
  ])('applies %j', (marks, expected) => {
    expect(adfToMarkdown(doc(para(text('bold', marks))))).toBe(expected)
  })

  it('renders a link', () => {
    const out = adfToMarkdown(
      doc(para(text('here', [{ type: 'link', attrs: { href: 'https://example.com' } }])))
    )
    expect(out).toBe('[here](https://example.com)')
  })

  it('composes several marks on one span', () => {
    const out = adfToMarkdown(doc(para(text('x', [{ type: 'strong' }, { type: 'em' }]))))
    expect(out).toBe('_**x**_')
  })

  it('does not wrap a code span in emphasis markers it cannot carry', () => {
    // A link around code is legitimate; code around code is not doubled.
    const out = adfToMarkdown(
      doc(
        para(text('fn', [{ type: 'code' }, { type: 'link', attrs: { href: 'https://d.example' } }]))
      )
    )
    expect(out).toBe('[`fn`](https://d.example)')
  })
})

describe('adfToMarkdown — degradation', () => {
  it('renders an unmapped node as its text content rather than dropping it', () => {
    const out = adfToMarkdown(
      doc({
        type: 'panel',
        attrs: { panelType: 'info' },
        content: [para(text('important note'))],
      })
    )
    expect(out).toBe('important note')
  })

  it('renders an unmapped leaf node with no text as nothing, without throwing', () => {
    expect(() => adfToMarkdown(doc({ type: 'mediaSingle', attrs: { width: 100 } }))).not.toThrow()
    expect(adfToMarkdown(doc({ type: 'mediaSingle', attrs: { width: 100 } }))).toBe('')
  })

  it('renders a mention as its display text', () => {
    const out = adfToMarkdown(doc(para({ type: 'mention', attrs: { text: '@andrew' } })))
    expect(out).toBe('@andrew')
  })

  it('does not throw on a malformed document', () => {
    for (const bad of [null, undefined, {}, { type: 'doc' }, { type: 'doc', content: null }, 42]) {
      expect(() => adfToMarkdown(bad)).not.toThrow()
      expect(typeof adfToMarkdown(bad)).toBe('string')
    }
  })

  it('does not throw on a node whose content is not an array', () => {
    expect(adfToMarkdown(doc({ type: 'paragraph', content: 'oops' }))).toBe('')
  })

  it('returns an empty string for an empty document', () => {
    expect(adfToMarkdown(doc())).toBe('')
  })

  it('accepts a plain string and returns it unchanged', () => {
    // Some Jira fields come back as plain text rather than ADF.
    expect(adfToMarkdown('already text')).toBe('already text')
  })
})

describe('adfToMarkdown — further degradation', () => {
  it('ignores a mark type it does not know', () => {
    expect(
      adfToMarkdown(doc(para(text('x', [{ type: 'textColor', attrs: { color: 'red' } }]))))
    ).toBe('x')
  })

  it('ignores a link mark with no href rather than emitting a broken link', () => {
    expect(adfToMarkdown(doc(para(text('x', [{ type: 'link', attrs: {} }]))))).toBe('x')
  })

  it('renders an inline card as its url', () => {
    expect(
      adfToMarkdown(doc(para({ type: 'inlineCard', attrs: { url: 'https://example.com/a' } })))
    ).toBe('https://example.com/a')
  })

  it('renders an inline card with no url as nothing', () => {
    expect(adfToMarkdown(doc(para({ type: 'inlineCard', attrs: {} })))).toBe('')
  })

  it('renders an emoji as its text', () => {
    expect(adfToMarkdown(doc(para({ type: 'emoji', attrs: { text: '🎉' } })))).toBe('🎉')
  })

  it('renders a mention with no display text as nothing', () => {
    expect(adfToMarkdown(doc(para({ type: 'mention', attrs: { id: 'abc' } })))).toBe('')
  })

  it('renders a text node with no text as nothing', () => {
    expect(adfToMarkdown(doc(para({ type: 'text' })))).toBe('')
  })

  it('defaults a heading with no level to h1', () => {
    expect(adfToMarkdown(doc({ type: 'heading', content: [text('x')] }))).toBe('# x')
  })

  it('clamps a heading level outside 1–6', () => {
    expect(
      adfToMarkdown(doc({ type: 'heading', attrs: { level: 99 }, content: [text('x')] }))
    ).toBe('###### x')
    expect(adfToMarkdown(doc({ type: 'heading', attrs: { level: 0 }, content: [text('x')] }))).toBe(
      '# x'
    )
  })

  it('renders a table with no header row and no separator', () => {
    const out = adfToMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [para(text('a'))] },
              { type: 'tableCell', content: [para(text('b'))] },
            ],
          },
        ],
      })
    )
    expect(out).toBe('| a | b |')
  })

  it('renders an empty table as nothing', () => {
    expect(adfToMarkdown(doc({ type: 'table', content: [] }))).toBe('')
  })

  it('ignores a non-string code block language', () => {
    expect(
      adfToMarkdown(doc({ type: 'codeBlock', attrs: { language: 7 }, content: [text('x')] }))
    ).toBe('```\nx\n```')
  })

  it('drops empty list items rather than emitting bare markers', () => {
    const out = adfToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [] },
          { type: 'listItem', content: [para(text('a'))] },
        ],
      })
    )
    expect(out).toBe('- a')
  })

  it('renders a top-level text node outside any paragraph', () => {
    expect(adfToMarkdown(doc(text('loose')))).toBe('loose')
  })
})
