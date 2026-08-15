import { describe, it, expect, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { TableWidget, AlertHeaderWidget } from '../../src/editor/livePreview'
import { parseTable, ALERT_KINDS } from '../../src/editor/markdownTable'

function makeView(docLength = 10_000) {
  const dispatch = vi.fn()
  const focus = vi.fn()
  return {
    view: { state: { doc: { length: docLength } }, dispatch, focus } as unknown as EditorView,
    dispatch,
    focus,
  }
}

function renderTable(source: string, from = 0, view = makeView().view): HTMLElement {
  const parsed = parseTable(source)
  if (!parsed) throw new Error('expected the fixture to parse as a table')
  return new TableWidget(source, parsed, from).toDOM(view)
}

describe('TableWidget', () => {
  const SOURCE = [
    '| Name | Notes | Count |',
    '| :--- | :---: | ---: |',
    '| apples | **fresh** | 3 |',
    '| pears | `ripe` | 12 |',
  ].join('\n')

  it('renders a real table element', () => {
    expect(renderTable(SOURCE).querySelector('table')).not.toBeNull()
  })

  it('renders one header cell per column', () => {
    const ths = renderTable(SOURCE).querySelectorAll('thead th')
    expect(Array.from(ths).map((th) => th.textContent)).toEqual(['Name', 'Notes', 'Count'])
  })

  it('renders one row per body line', () => {
    expect(renderTable(SOURCE).querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('renders cell text', () => {
    const firstRow = renderTable(SOURCE).querySelectorAll('tbody tr')[0]
    expect(Array.from(firstRow.children).map((td) => td.textContent)).toEqual([
      'apples',
      'fresh',
      '3',
    ])
  })

  it('applies per-column alignment', () => {
    const ths = renderTable(SOURCE).querySelectorAll<HTMLElement>('thead th')
    expect(ths[0].style.textAlign).toBe('left')
    expect(ths[1].style.textAlign).toBe('center')
    expect(ths[2].style.textAlign).toBe('right')
  })

  it('renders inline markup inside cells rather than showing the markers', () => {
    const dom = renderTable(SOURCE)
    expect(dom.querySelector('tbody strong')?.textContent).toBe('fresh')
    expect(dom.querySelector('tbody code')?.textContent).toBe('ripe')
  })

  it('renders a header-only table without a body row', () => {
    const dom = renderTable('| A | B |\n| --- | --- |')
    expect(dom.querySelectorAll('thead th')).toHaveLength(2)
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(0)
  })

  it('does not interpret cell text as HTML', () => {
    const dom = renderTable('| A |\n| --- |\n| <img src=x> |')
    expect(dom.querySelector('img')).toBeNull()
    expect(dom.querySelector('tbody td')?.textContent).toBe('<img src=x>')
  })

  it('treats widgets with identical source and position as equal, so redraws are skipped', () => {
    const a = new TableWidget(SOURCE, parseTable(SOURCE)!, 0)
    const b = new TableWidget(SOURCE, parseTable(SOURCE)!, 0)
    expect(a.eq(b)).toBe(true)
  })

  it('treats widgets with different source as unequal', () => {
    const other = '| A |\n| --- |\n| x |'
    const a = new TableWidget(SOURCE, parseTable(SOURCE)!, 0)
    const b = new TableWidget(other, parseTable(other)!, 0)
    expect(a.eq(b)).toBe(false)
  })

  it('treats an identical table at a different position as unequal', () => {
    const a = new TableWidget(SOURCE, parseTable(SOURCE)!, 0)
    const b = new TableWidget(SOURCE, parseTable(SOURCE)!, 40)
    expect(a.eq(b)).toBe(false)
  })
})

// A replaced range cannot be clicked into, so without this the rendered table
// would be uneditable — the caret could never get inside it.
describe('TableWidget editing', () => {
  const SOURCE = ['| Name | Count |', '| --- | --- |', '| apples | 3 |'].join('\n')

  function clickCell(selector: string, index: number, from = 0) {
    const { view, dispatch, focus } = makeView()
    const dom = renderTable(SOURCE, from, view)
    const cells = dom.querySelectorAll<HTMLElement>(selector)
    cells[index].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    return { dispatch, focus }
  }

  it('puts the caret in the clicked header cell', () => {
    const { dispatch } = clickCell('thead th', 0)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { anchor: SOURCE.indexOf('Name') } })
    )
  })

  it('puts the caret in the clicked body cell', () => {
    const { dispatch } = clickCell('tbody td', 0)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { anchor: SOURCE.indexOf('apples') } })
    )
  })

  it('distinguishes columns within a row', () => {
    const { dispatch } = clickCell('tbody td', 1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { anchor: SOURCE.indexOf('3') } })
    )
  })

  it('offsets the caret by the table position in the document', () => {
    const { dispatch } = clickCell('thead th', 1, 500)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { anchor: 500 + SOURCE.indexOf('Count') } })
    )
  })

  it('focuses the editor so the user can type straight away', () => {
    const { focus } = clickCell('tbody td', 0)
    expect(focus).toHaveBeenCalled()
  })

  it('scrolls the caret into view', () => {
    const { dispatch } = clickCell('tbody td', 0)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ scrollIntoView: true }))
  })

  it('clamps the caret to the document length', () => {
    const { view, dispatch } = makeView(5)
    const dom = renderTable(SOURCE, 0, view)
    dom
      .querySelectorAll<HTMLElement>('tbody td')[1]
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ selection: { anchor: 5 } }))
  })

  it('prevents the default so the browser does not fight the caret placement', () => {
    const { view } = makeView()
    const dom = renderTable(SOURCE, 0, view)
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    dom.querySelector('tbody td')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('advertises that cells are clickable', () => {
    expect(renderTable(SOURCE).querySelector('table')?.getAttribute('title')).toMatch(/edit/i)
  })
})

describe('AlertHeaderWidget', () => {
  it.each(ALERT_KINDS)('renders the %s label', (kind) => {
    const dom = new AlertHeaderWidget(kind).toDOM()
    expect(dom.querySelector('.notepad-alert__label')?.textContent?.toLowerCase()).toBe(kind)
  })

  it('carries the kind in its class so CSS can colour it', () => {
    const dom = new AlertHeaderWidget('caution').toDOM()
    expect(dom.className).toContain('notepad-alert__header--caution')
  })

  it('hides the decorative icon from assistive tech', () => {
    const dom = new AlertHeaderWidget('note').toDOM()
    expect(dom.querySelector('.notepad-alert__icon')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('treats widgets of the same kind as equal', () => {
    expect(new AlertHeaderWidget('tip').eq(new AlertHeaderWidget('tip'))).toBe(true)
    expect(new AlertHeaderWidget('tip').eq(new AlertHeaderWidget('note'))).toBe(false)
  })
})
