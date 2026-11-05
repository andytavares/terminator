import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { describe, it, expect } from 'vitest'
import { DiffView, linesFromTexts } from '@terminator/extension-ui'
import type { DiffViewHunk } from '@terminator/extension-ui'

const HUNKS: DiffViewHunk[] = [
  {
    header: '@@ -1,3 +1,3 @@',
    lines: [
      { type: 'context', content: 'const a = 1', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'remove', content: 'const b = 2', oldLineNumber: 2, newLineNumber: null },
      { type: 'add', content: 'const b = 3', oldLineNumber: null, newLineNumber: 2 },
    ],
  },
]

describe('DiffView', () => {
  it('renders add, remove and context rows with their line numbers', () => {
    const { container } = render(<DiffView hunks={HUNKS} />)
    expect(container.querySelectorAll('tr.diff-line--context')).toHaveLength(1)
    expect(container.querySelector('tr.diff-line--remove .diff-line__old-num')?.textContent).toBe(
      '2'
    )
    expect(container.querySelector('tr.diff-line--add .diff-line__new-num')?.textContent).toBe('2')
    expect(container.querySelector('.diff-hunk-header')?.textContent).toBe('@@ -1,3 +1,3 @@')
  })

  it('renders each side of a split change on one row', () => {
    const { container } = render(<DiffView hunks={HUNKS} layout="split" />)
    expect(container.querySelector('.diff-table--split')).toBeTruthy()
    expect(container.querySelectorAll('tr.diff-line')).toHaveLength(2)
  })
})

describe('DiffView highlighting', () => {
  it('escapes markup in a line instead of rendering it', () => {
    const hostile: DiffViewHunk[] = [
      {
        header: '@@',
        lines: [
          {
            type: 'add',
            content: '<script>alert(1)</script>',
            oldLineNumber: null,
            newLineNumber: 1,
          },
        ],
      },
    ]
    const { container } = render(<DiffView hunks={hostile} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('.diff-line__content')?.textContent).toBe(
      '<script>alert(1)</script>'
    )
  })

  it('highlights a line when the language is known', () => {
    const { container } = render(<DiffView hunks={HUNKS} language="ts" />)
    expect(container.querySelector('.hljs-keyword')).toBeTruthy()
  })
})

describe('linesFromTexts', () => {
  it('marks every line added when there is no old text', () => {
    expect(linesFromTexts(null, 'a\nb')).toEqual([
      { type: 'add', content: 'a', oldLineNumber: null, newLineNumber: 1 },
      { type: 'add', content: 'b', oldLineNumber: null, newLineNumber: 2 },
    ])
  })

  it('marks a changed middle line removed then added', () => {
    expect(linesFromTexts('a\nb\nc', 'a\nB\nc')).toEqual([
      { type: 'context', content: 'a', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'remove', content: 'b', oldLineNumber: 2, newLineNumber: null },
      { type: 'add', content: 'B', oldLineNumber: null, newLineNumber: 2 },
      { type: 'context', content: 'c', oldLineNumber: 3, newLineNumber: 3 },
    ])
  })
})

describe('diff styles', () => {
  it('take every colour from a token, so the checked AA contrast of the tokens holds', () => {
    const css = readFileSync(
      join(process.cwd(), 'packages/extension-ui/src/extension-ui.css'),
      'utf8'
    )
    const diffCss = css.slice(css.indexOf('/* ── Diff view'))
    expect(diffCss).toContain('.diff-table')
    expect(diffCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
})
