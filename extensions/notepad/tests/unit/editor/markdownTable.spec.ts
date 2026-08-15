import { describe, it, expect } from 'vitest'
import {
  ALERT_KINDS,
  ALERT_LABELS,
  parseAlertMarker,
  parseDelimiterRow,
  parseInlineSpans,
  parseTable,
  splitTableRow,
} from '../../../src/editor/markdownTable'

describe('splitTableRow', () => {
  it('splits a fenced row into cells', () => {
    expect(splitTableRow('| a | b | c |')).toEqual(['a', 'b', 'c'])
  })

  it('splits an unfenced row', () => {
    expect(splitTableRow('a | b | c')).toEqual(['a', 'b', 'c'])
  })

  it('trims surrounding whitespace from each cell', () => {
    expect(splitTableRow('|   padded   |  cells |')).toEqual(['padded', 'cells'])
  })

  it('keeps empty interior cells so columns stay aligned', () => {
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c'])
  })

  it('does not split on an escaped pipe', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a \\| b', 'c'])
  })

  it('handles a single-column row', () => {
    expect(splitTableRow('| only |')).toEqual(['only'])
  })
})

describe('parseDelimiterRow', () => {
  it('returns null alignment for a plain delimiter row', () => {
    expect(parseDelimiterRow('| --- | --- |')).toEqual([null, null])
  })

  it('reads left, center, and right alignment', () => {
    expect(parseDelimiterRow('| :--- | :---: | ---: |')).toEqual(['left', 'center', 'right'])
  })

  it('accepts a single dash per column', () => {
    expect(parseDelimiterRow('|-|-|')).toEqual([null, null])
  })

  it('rejects a row that is not a delimiter row', () => {
    expect(parseDelimiterRow('| a | b |')).toBeNull()
  })

  it('rejects a row where only some cells are delimiters', () => {
    expect(parseDelimiterRow('| --- | oops |')).toBeNull()
  })
})

describe('parseTable', () => {
  const table = ['| Name | Count |', '| --- | ---: |', '| apples | 3 |', '| pears | 12 |'].join(
    '\n'
  )

  it('parses header, alignment, and rows', () => {
    expect(parseTable(table)).toEqual({
      header: ['Name', 'Count'],
      align: [null, 'right'],
      rows: [
        ['apples', '3'],
        ['pears', '12'],
      ],
    })
  })

  it('parses a header-only table', () => {
    expect(parseTable('| A | B |\n| --- | --- |')).toEqual({
      header: ['A', 'B'],
      align: [null, null],
      rows: [],
    })
  })

  it('pads short rows to the header column count', () => {
    const parsed = parseTable('| A | B | C |\n| --- | --- | --- |\n| only |')
    expect(parsed?.rows).toEqual([['only', '', '']])
  })

  it('truncates rows with more cells than the header', () => {
    const parsed = parseTable('| A |\n| --- |\n| x | extra |')
    expect(parsed?.rows).toEqual([['x']])
  })

  it('skips blank lines between rows', () => {
    const parsed = parseTable('| A |\n| --- |\n| x |\n\n')
    expect(parsed?.rows).toEqual([['x']])
  })

  it('returns null without a delimiter row', () => {
    expect(parseTable('| A | B |\n| x | y |')).toBeNull()
  })

  it('returns null for a single line', () => {
    expect(parseTable('| A | B |')).toBeNull()
  })
})

describe('parseInlineSpans', () => {
  it('returns a single text span for plain text', () => {
    expect(parseInlineSpans('just words')).toEqual([{ type: 'text', text: 'just words' }])
  })

  it('returns nothing for an empty cell', () => {
    expect(parseInlineSpans('')).toEqual([])
  })

  it('parses bold', () => {
    expect(parseInlineSpans('**loud**')).toEqual([{ type: 'strong', text: 'loud' }])
  })

  it('parses italic', () => {
    expect(parseInlineSpans('*soft*')).toEqual([{ type: 'em', text: 'soft' }])
  })

  it('prefers bold over italic so ** is not read as two delimiters', () => {
    expect(parseInlineSpans('**bold**')[0].type).toBe('strong')
  })

  it('parses inline code', () => {
    expect(parseInlineSpans('`code()`')).toEqual([{ type: 'code', text: 'code()' }])
  })

  it('leaves markup inside code literal', () => {
    expect(parseInlineSpans('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }])
  })

  it('parses strikethrough', () => {
    expect(parseInlineSpans('~~gone~~')).toEqual([{ type: 'del', text: 'gone' }])
  })

  it('parses a link with its href', () => {
    expect(parseInlineSpans('[docs](https://example.com)')).toEqual([
      { type: 'link', text: 'docs', href: 'https://example.com' },
    ])
  })

  it('keeps surrounding text around a span', () => {
    expect(parseInlineSpans('see **this** now')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'strong', text: 'this' },
      { type: 'text', text: ' now' },
    ])
  })

  it('parses several spans in one cell', () => {
    expect(parseInlineSpans('**a** and `b`')).toEqual([
      { type: 'strong', text: 'a' },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'b' },
    ])
  })

  it('unescapes pipes that were escaped to survive cell splitting', () => {
    expect(parseInlineSpans('a \\| b')).toEqual([{ type: 'text', text: 'a | b' }])
  })

  it('leaves an unmatched marker as literal text', () => {
    expect(parseInlineSpans('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }])
  })
})

describe('parseAlertMarker', () => {
  it.each(ALERT_KINDS)('recognises the %s alert', (kind) => {
    expect(parseAlertMarker(`> [!${kind.toUpperCase()}]`)).toBe(kind)
  })

  it('is case-insensitive', () => {
    expect(parseAlertMarker('> [!Note]')).toBe('note')
  })

  it('tolerates extra spacing', () => {
    expect(parseAlertMarker('>   [!TIP]   ')).toBe('tip')
  })

  it('rejects an unknown alert type', () => {
    expect(parseAlertMarker('> [!DANGER]')).toBeNull()
  })

  it('rejects a plain blockquote', () => {
    expect(parseAlertMarker('> just a quote')).toBeNull()
  })

  it('rejects a marker with trailing content on the same line', () => {
    expect(parseAlertMarker('> [!NOTE] inline text')).toBeNull()
  })

  it('rejects a line that is not a blockquote', () => {
    expect(parseAlertMarker('[!NOTE]')).toBeNull()
  })

  it('has a label for every kind', () => {
    for (const kind of ALERT_KINDS) expect(ALERT_LABELS[kind]).toBeTruthy()
  })
})
