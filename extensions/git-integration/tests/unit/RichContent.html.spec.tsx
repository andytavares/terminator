import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { RichContent } from '../../src/components/pr-review/RichContent'

const mockOpenExternal = vi.fn().mockResolvedValue({ ok: true })

Object.defineProperty(window, 'electronAPI', {
  writable: true,
  value: { shell: { openExternal: mockOpenExternal } },
})

function renderBody(body: string) {
  return render(<RichContent>{body}</RichContent>).container
}

describe('RichContent raw HTML', () => {
  beforeEach(() => {
    mockOpenExternal.mockClear()
  })

  it('renders <details>/<summary> as a disclosure, not tag text', () => {
    const el = renderBody('<details><summary>Logs</summary>body</details>')
    expect(el.querySelector('details > summary')?.textContent).toBe('Logs')
    expect(el.querySelector('details')?.textContent).toContain('body')
    expect(el.textContent).not.toContain('<details>')
    expect(el.textContent).not.toContain('<summary>')
  })

  it('renders <br> as a line break', () => {
    const el = renderBody('a<br>b')
    expect(el.querySelector('br')).not.toBeNull()
    expect(el.textContent).toBe('ab')
  })

  it('renders <sub> as an element', () => {
    const el = renderBody('<sub>x</sub>')
    expect(el.querySelector('sub')?.textContent).toBe('x')
    expect(el.textContent).not.toContain('<sub>')
  })

  it('links a GFM footnote reference to its definition', () => {
    const el = renderBody('text[^1]\n\n[^1]: note')
    const ref = el.querySelector('sup > a')
    const href = ref?.getAttribute('href') ?? ''
    expect(href.startsWith('#')).toBe(true)
    const target = el.querySelector(`[id="${href.slice(1)}"]`)
    expect(target?.textContent).toContain('note')
    expect(href).not.toContain('user-content-user-content-')
  })

  it('still highlights fenced code by language', () => {
    const el = renderBody('```js\nconst a = 1\n```')
    expect(el.querySelector('pre > code.hljs.language-js')).not.toBeNull()
  })

  describe('sanitising', () => {
    it('drops <script>, <iframe> and <style>', () => {
      const el = renderBody(
        [
          '<script>alert(1)</script>',
          '<iframe src="https://evil.example"></iframe>',
          '<style>body{display:none}</style>',
          'after',
        ].join('\n\n')
      )
      expect(el.querySelector('script')).toBeNull()
      expect(el.querySelector('iframe')).toBeNull()
      expect(el.querySelector('style')).toBeNull()
      expect(el.textContent).not.toContain('alert(1)')
      expect(el.textContent).not.toContain('display:none')
      expect(el.textContent).toContain('after')
    })

    it('strips on* handlers from an allowed element', () => {
      const el = renderBody('<img src="https://example.com/a.png" onerror="alert(1)">')
      const img = el.querySelector('img')
      expect(img?.getAttribute('src')).toBe('https://example.com/a.png')
      const handlers = Array.from(el.querySelectorAll('*')).flatMap((node) =>
        Array.from(node.attributes).filter((a) => a.name.toLowerCase().startsWith('on'))
      )
      expect(handlers).toEqual([])
    })

    it('removes javascript: hrefs', () => {
      const el = renderBody('<a href="javascript:alert(1)">click</a>')
      const hrefs = Array.from(el.querySelectorAll('[href]')).map((n) => n.getAttribute('href'))
      expect(hrefs.some((h) => h?.toLowerCase().includes('javascript:'))).toBe(false)
    })

    it('opens an HTML <a href="https://…"> via shell.openExternal', () => {
      const el = renderBody('<a href="https://example.com/pr">PR</a>')
      const link = el.querySelector('a')!
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/pr')
      expect(event.defaultPrevented).toBe(true)
    })
  })
})
