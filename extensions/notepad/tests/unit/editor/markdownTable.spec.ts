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
  const texts = (line: string) => splitTableRow(line).map((c) => c.text)

  it('splits a fenced row into cells', () => {
    expect(texts('| a | b | c |')).toEqual(['a', 'b', 'c'])
  })

  it('splits an unfenced row', () => {
    expect(texts('a | b | c')).toEqual(['a', 'b', 'c'])
  })

  it('trims surrounding whitespace from each cell', () => {
    expect(texts('|   padded   |  cells |')).toEqual(['padded', 'cells'])
  })

  it('keeps empty interior cells so columns stay aligned', () => {
    expect(texts('| a |  | c |')).toEqual(['a', '', 'c'])
  })

  it('does not split on an escaped pipe', () => {
    expect(texts('| a \\| b | c |')).toEqual(['a \\| b', 'c'])
  })

  it('handles a single-column row', () => {
    expect(texts('| only |')).toEqual(['only'])
  })

  // Offsets are what let a click on a rendered cell put the caret in the right
  // place in the source.
  it('reports where each cell text starts', () => {
    const line = '| a | b |'
    const cells = splitTableRow(line)
    expect(cells.map((c) => c.offset)).toEqual([line.indexOf('a'), line.indexOf('b')])
  })

  it('points past the padding, at the first visible character', () => {
    const line = '|    spaced    |'
    expect(splitTableRow(line)[0].offset).toBe(line.indexOf('s'))
  })

  it('reports an offset for an empty cell', () => {
    const cells = splitTableRow('| a |  | c |')
    expect(cells[1].offset).toBeGreaterThan(cells[0].offset)
    expect(cells[1].offset).toBeLessThan(cells[2].offset)
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

  const rowTexts = (source: string) => parseTable(source)?.rows.map((row) => row.map((c) => c.text))

  it('parses header, alignment, and rows', () => {
    const parsed = parseTable(table)
    expect(parsed?.header.map((c) => c.text)).toEqual(['Name', 'Count'])
    expect(parsed?.align).toEqual([null, 'right'])
    expect(rowTexts(table)).toEqual([
      ['apples', '3'],
      ['pears', '12'],
    ])
  })

  it('parses a header-only table', () => {
    const parsed = parseTable('| A | B |\n| --- | --- |')
    expect(parsed?.header.map((c) => c.text)).toEqual(['A', 'B'])
    expect(parsed?.align).toEqual([null, null])
    expect(parsed?.rows).toEqual([])
  })

  it('pads short rows to the header column count', () => {
    expect(rowTexts('| A | B | C |\n| --- | --- | --- |\n| only |')).toEqual([['only', '', '']])
  })

  it('truncates rows with more cells than the header', () => {
    expect(rowTexts('| A |\n| --- |\n| x | extra |')).toEqual([['x']])
  })

  it('skips blank lines between rows', () => {
    expect(rowTexts('| A |\n| --- |\n| x |\n\n')).toEqual([['x']])
  })

  it('reports cell offsets against the whole table source', () => {
    const parsed = parseTable(table)
    expect(parsed?.header[0].offset).toBe(table.indexOf('Name'))
    expect(parsed?.rows[0][0].offset).toBe(table.indexOf('apples'))
    expect(parsed?.rows[1][1].offset).toBe(table.indexOf('12'))
  })

  it('points a padded cell at the end of its row', () => {
    const source = '| A | B |\n| --- | --- |\n| only |'
    const parsed = parseTable(source)
    expect(parsed?.rows[0][1].offset).toBe(source.length)
  })

  it('keeps offsets correct when a blank line precedes a row', () => {
    const source = '| A |\n| --- |\n| x |\n\n| y |'
    const parsed = parseTable(source)
    expect(parsed?.rows[1][0].offset).toBe(source.lastIndexOf('y'))
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
