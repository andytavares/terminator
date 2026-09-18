import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { HunkLines, languageOf } from '../../src/components/HunkLines.js'

// A hunk read as a diff: which lines were added and removed, in the colours
// the git view uses, with the code highlighted. It was one grey <pre>.

const LINES = [
  '   issues: (found.issues ?? [])',
  '-    .map((issue) => issue.key)',
  "+    .filter((issue) => issue.state?.type !== 'completed')",
  '+    .map((issue) => issue.key)',
]

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.fdry-diff-line'))
}

describe('HunkLines', () => {
  it('marks each line added, removed or unchanged', () => {
    const { container } = render(<HunkLines file="src/index.ts" newStart={10} lines={LINES} />)
    expect(rows(container).map((r) => r.className.replace('fdry-diff-line ', ''))).toEqual([
      'is-context',
      'is-remove',
      'is-add',
      'is-add',
    ])
  })

  it('numbers the lines as they are in the new file, and a removed line not at all', () => {
    const { container } = render(<HunkLines file="src/index.ts" newStart={10} lines={LINES} />)
    const numbers = rows(container).map((r) => r.querySelector('.fdry-diff-num')?.textContent ?? '')
    expect(numbers).toEqual(['10', '', '11', '12'])
  })

  it('shows the sign apart from the code, and the code without it', () => {
    const { container } = render(<HunkLines file="src/index.ts" newStart={10} lines={LINES} />)
    const removed = rows(container)[1]
    expect(removed.querySelector('.fdry-diff-sign')?.textContent).toBe('-')
    expect(removed.querySelector('.fdry-diff-code')?.textContent).toBe(
      '    .map((issue) => issue.key)'
    )
  })

  it('highlights the code by the file’s language', () => {
    const { container } = render(<HunkLines file="src/index.ts" newStart={10} lines={LINES} />)
    const added = rows(container)[2]
    expect(added.querySelector('.hljs-string')?.textContent).toBe("'completed'")
  })

  // The hunk is written by an agent. Markup in it is text, never markup.
  it('renders markup in the code as text', () => {
    const { container } = render(
      <HunkLines file="notes.unknown" newStart={1} lines={['+<img src=x onerror=alert(1)>']} />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('leaves git’s "no newline" marker out of the numbering', () => {
    const { container } = render(
      <HunkLines
        file="a.ts"
        newStart={3}
        lines={['+const a = 1', '\\ No newline at end of file']}
      />
    )
    const numbers = rows(container).map((r) => r.querySelector('.fdry-diff-num')?.textContent ?? '')
    expect(numbers).toEqual(['3', ''])
  })
})

describe('languageOf', () => {
  it('reads the language from the extension', () => {
    expect(languageOf('src/a.tsx')).toBe('typescript')
    expect(languageOf('main.py')).toBe('python')
    expect(languageOf('cmd/main.go')).toBe('go')
  })

  it('has none for a file it does not know', () => {
    expect(languageOf('notes.unknown')).toBeUndefined()
  })
})
