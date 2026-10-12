import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { RichContent } from '../../src/components/pr-review/RichContent'

const mockOpenExternal = vi.fn().mockResolvedValue({ ok: true })

Object.defineProperty(window, 'electronAPI', {
  writable: true,
  value: { shell: { openExternal: mockOpenExternal } },
})

// The sanitising, link and HTML behaviour belongs to the design system's
// Markdown and is specified in tests/unit/packages/extension-ui/markdown.spec.tsx;
// this file covers what the review UI adds to it.
describe('RichContent', () => {
  beforeEach(() => mockOpenExternal.mockClear())

  it('keeps the rich-content class the review stylesheet targets', () => {
    const { container } = render(<RichContent className="extra">Content</RichContent>)
    expect(container.querySelector('.rich-content.extra')).not.toBeNull()
  })

  it('opens an absolute address through the shell, not in the view', () => {
    const { container } = render(<RichContent>{'[PR](https://example.com/pr)'}</RichContent>)
    fireEvent.click(container.querySelector('a')!)
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/pr')
  })

  it('highlights a fenced block by its language', () => {
    const { container } = render(<RichContent>{'```js\nconst a = 1\n```'}</RichContent>)
    const code = container.querySelector('pre code.hljs.language-js')
    expect(code?.querySelector('span')).not.toBeNull()
    expect(code?.textContent).toBe('const a = 1')
  })

  it('highlights a block whose language the highlighter does not know', () => {
    const { container } = render(<RichContent>{'```nonesuch\nplain words\n```'}</RichContent>)
    expect(container.querySelector('pre code.hljs.language-nonesuch')?.textContent).toBe(
      'plain words'
    )
  })

  it('leaves inline code unhighlighted', () => {
    const { container } = render(<RichContent>{'run `npm ci`'}</RichContent>)
    expect(container.querySelector('code.hljs')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('npm ci')
  })
})
