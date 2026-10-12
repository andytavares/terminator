import React from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { Markdown } from '../../../../packages/extension-ui/src/Markdown'

const onOpenLink = vi.fn()

function renderBody(body: string) {
  return render(<Markdown onOpenLink={onOpenLink}>{body}</Markdown>).container
}

describe('Markdown before its HTML renderer has loaded', () => {
  it('shows no tag text and no unsafe element, then renders the HTML', async () => {
    vi.resetModules()
    const { Markdown: Fresh } = await import('../../../../packages/extension-ui/src/Markdown')
    const el = render(
      <Fresh onOpenLink={onOpenLink}>
        {'<details><summary>Logs</summary>body</details>\n\n<script>alert(1)</script>'}
      </Fresh>
    ).container
    expect(el.textContent).not.toContain('<details>')
    expect(el.textContent).not.toContain('alert(1)')
    expect(el.querySelector('script')).toBeNull()
    await waitFor(() => expect(el.querySelector('details > summary')?.textContent).toBe('Logs'))
    expect(el.querySelector('script')).toBeNull()
  })
})

describe('Markdown raw HTML', () => {
  beforeAll(async () => {
    const el = renderBody('<sub>x</sub>')
    await waitFor(() => expect(el.querySelector('sub')).not.toBeNull())
  })

  beforeEach(() => {
    onOpenLink.mockClear()
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

  it('leaves a fenced block as plain code when no code renderer is given', () => {
    const el = renderBody('```js\nconst a = 1\n```')
    expect(el.querySelector('pre > code.language-js')?.textContent).toBe('const a = 1\n')
  })

  it('hands a fenced block and its language to the code renderer', () => {
    const renderCode = vi.fn((code: string, language: string) => (
      <b data-language={language}>{code}</b>
    ))
    const el = render(
      <Markdown onOpenLink={onOpenLink} renderCode={renderCode}>
        {'```js\nconst a = 1\n```'}
      </Markdown>
    ).container
    expect(renderCode).toHaveBeenCalledWith('const a = 1', 'js')
    expect(el.querySelector('b[data-language="js"]')?.textContent).toBe('const a = 1')
  })

  it('keeps inline code out of the code renderer', () => {
    const renderCode = vi.fn(() => <b />)
    const el = render(
      <Markdown onOpenLink={onOpenLink} renderCode={renderCode}>
        {'use `npm ci` here'}
      </Markdown>
    ).container
    expect(renderCode).not.toHaveBeenCalled()
    expect(el.querySelector('code')?.textContent).toBe('npm ci')
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

    it('prefixes every id and name so a body cannot clobber document members', () => {
      const el = renderBody(
        '<img name="createElement" src="https://example.com/a.png">\n\n<div id="getElementById">x</div>\n\ntext[^1]\n\n[^1]: note'
      )
      document.body.appendChild(el)
      const values = [
        ...Array.from(el.querySelectorAll('[name]')).map((n) => n.getAttribute('name')),
        ...Array.from(el.querySelectorAll('[id]')).map((n) => n.getAttribute('id')),
      ]
      expect(values).toContain('user-content-createElement')
      expect(values).toContain('user-content-getElementById')
      expect(values.every((v) => v?.startsWith('user-content-'))).toBe(true)
      expect(values.some((v) => v?.startsWith('user-content-user-content-'))).toBe(false)
      expect(typeof document.createElement).toBe('function')
      expect(typeof document.getElementById).toBe('function')
      el.remove()
    })

    it('points an in-page HTML anchor at the prefixed id', () => {
      const el = renderBody('<a href="#notes">jump</a>\n\n<h3 id="notes">Notes</h3>')
      const href = el.querySelector('a')?.getAttribute('href') ?? ''
      expect(href).toBe('#user-content-notes')
      expect(el.querySelector(`[id="${href.slice(1)}"]`)?.textContent).toBe('Notes')
    })

    it('opens an HTML <a href="https://…"> through onOpenLink', () => {
      const el = renderBody('<a href="https://example.com/pr">PR</a>')
      const link = el.querySelector('a')!
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(onOpenLink).toHaveBeenCalledWith('https://example.com/pr')
      expect(event.defaultPrevented).toBe(true)
    })
  })
})

describe('Markdown links', () => {
  const link = (body: string) => {
    const { container } = render(<Markdown onOpenLink={onOpenLink}>{body}</Markdown>)
    return container.querySelector('a')!
  }
  const click = (anchor: HTMLElement) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)
    return event
  }

  beforeEach(() => onOpenLink.mockClear())

  it('opens an https address through onOpenLink and keeps the view where it is', () => {
    const event = click(link('[PR](https://example.com/pr)'))
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/pr')
    expect(event.defaultPrevented).toBe(true)
  })

  it('opens an http address through onOpenLink', () => {
    click(link('[PR](http://example.com/pr)'))
    expect(onOpenLink).toHaveBeenCalledWith('http://example.com/pr')
  })

  it('lets an in-page link scroll the view', () => {
    const anchor = link('[jump](#section)')
    expect(click(anchor).defaultPrevented).toBe(false)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('points an in-page link at the prefixed id the sanitiser gives the target', () => {
    expect(link('[jump](#section)').getAttribute('href')).toBe('#user-content-section')
  })

  it('leaves an already-prefixed in-page link alone', () => {
    expect(link('[jump](#user-content-section)').getAttribute('href')).toBe('#user-content-section')
  })

  it('keeps a relative href from navigating the view', () => {
    const event = click(link('[x](./relative/path)'))
    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('keeps a protocol-relative href from navigating the view', () => {
    const event = click(link('[x](//evil.example/x)'))
    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('adds the caller class beside its own', () => {
    const { container } = render(
      <Markdown onOpenLink={onOpenLink} className="extra">
        text
      </Markdown>
    )
    expect(container.firstElementChild?.className).toBe('tmui-markdown extra')
  })
})
