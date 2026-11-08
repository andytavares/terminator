import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RichContent } from '../../src/components/pr-review/RichContent'

const mockOpenExternal = vi.fn()

// The sanitising, link and HTML behaviour belongs to the design system's
// Markdown and is specified in tests/unit/packages/extension-ui/markdown.spec.tsx;
// this file covers what the review UI adds to it.
beforeEach(() => {
  mockOpenExternal.mockResolvedValue({ ok: true })
  vi.stubGlobal('electronAPI', { shell: { openExternal: mockOpenExternal } })
})

describe('RichContent', () => {
  it('keeps the rich-content class the review stylesheet targets', () => {
    const { container } = render(<RichContent className="extra">Content</RichContent>)
    expect(container.innerHTML).toContain('rich-content extra')
  })

  it('opens an absolute address through the shell, not in the view', async () => {
    const user = userEvent.setup()
    render(<RichContent>{'<hr>\n\n[PR](https://example.com/pr)'}</RichContent>)
    // Raw HTML draws once the sanitiser loads; that render replaces the link element.
    await screen.findByRole('separator')
    await user.click(screen.getByRole('link', { name: 'PR' }))
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/pr')
  })

  it('highlights a fenced block by its language', () => {
    render(<RichContent>{'```js\nconst a = 1\n```'}</RichContent>)
    const code = screen.getByRole('code')
    expect(code.className).toBe('hljs language-js')
    expect(code.innerHTML).toContain('<span')
    expect(code.textContent).toBe('const a = 1')
  })

  it('highlights a block whose language the highlighter does not know', () => {
    render(<RichContent>{'```nonesuch\nplain words\n```'}</RichContent>)
    const code = screen.getByRole('code')
    expect(code.className).toBe('hljs language-nonesuch')
    expect(code.textContent).toBe('plain words')
  })
})

describe('RichContent — leaves inline code unhighlighted', () => {
  it('leaves inline code unhighlighted', () => {
    render(<RichContent>{'run `npm ci`'}</RichContent>)
    const code = screen.getByRole('code')
    expect(code.classList.contains('hljs')).toBe(false)
    expect(code.textContent).toBe('npm ci')
  })
})
