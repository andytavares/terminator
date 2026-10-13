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

/** The hooks every "Markdown raw HTML" describe registers. */
function setUpMarkdownRawHTML(): void {
  beforeAll(async () => {
    const el = renderBody('<sub>x</sub>')
    await waitFor(() => expect(el.querySelector('sub')).not.toBeNull())
  })

  beforeEach(() => {
    onOpenLink.mockClear()
  })
}

describe('Markdown raw HTML', () => {
  setUpMarkdownRawHTML()

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
})

describe('Markdown raw HTML — leaves a fenced block as plain code when no code renderer is given', () => {
  setUpMarkdownRawHTML()

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
})

describe('Markdown raw HTML — sanitising', () => {
  setUpMarkdownRawHTML()

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
})

describe('Markdown raw HTML — sanitising — removes javascript: hrefs', () => {
  setUpMarkdownRawHTML()

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
})

describe('Markdown raw HTML — sanitising — points an in-page HTML anchor at the prefixed id', () => {
  setUpMarkdownRawHTML()

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

const link = (body: string) => {
  const { container } = render(<Markdown onOpenLink={onOpenLink}>{body}</Markdown>)
  return container.querySelector('a')!
}

const click = (anchor: HTMLElement) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  anchor.dispatchEvent(event)
  return event
}

/** The hooks every "Markdown links" describe registers. */
function setUpMarkdownLinks(): void {
  beforeEach(() => onOpenLink.mockClear())
}

describe('Markdown links', () => {
  setUpMarkdownLinks()

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
})

describe('Markdown links — keeps a protocol-relative href from navigating the view', () => {
  setUpMarkdownLinks()

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

describe('Markdown links to other schemes', () => {
  const click = (anchor: Element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)
    return event
  }

  beforeEach(() => onOpenLink.mockClear())

  it('opens a mailto address through onOpenLink', () => {
    const event = click(renderBody('[mail](mailto:team@example.com)').querySelector('a')!)
    expect(onOpenLink).toHaveBeenCalledWith('mailto:team@example.com')
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps a link with no destination from reloading the view', () => {
    const event = click(renderBody('[empty]()').querySelector('a')!)
    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('leaves a javascript: link inert', () => {
    const anchor = renderBody('[click me](javascript:window.__pwned=3)').querySelector('a')!
    expect(click(anchor).defaultPrevented).toBe(true)
    expect(anchor.getAttribute('href') ?? '').not.toContain('javascript:')
    expect(onOpenLink).not.toHaveBeenCalled()
  })
})

// Text from a tracker is written by anyone who can comment on the ticket. A remote
// image in it is a tracking pixel aimed at whoever opens it, so nothing may fetch.
function renderUntrusted(body: string) {
  return render(
    <Markdown onOpenLink={onOpenLink} fetchesNothing>
      {body}
    </Markdown>
  ).container
}

describe('Markdown that fetches nothing', () => {
  it('drops a Markdown image instead of loading it', () => {
    const el = renderUntrusted('![tracker](https://evil.example/pixel.png)')
    expect(el.querySelector('img')).toBeNull()
    expect(el.innerHTML).not.toContain('evil.example')
  })

  it('renders no raw HTML and no src attribute, even once the HTML renderer has loaded', async () => {
    const warm = renderBody('<sub>warm</sub>')
    await waitFor(() => expect(warm.querySelector('sub')).not.toBeNull())
    const el = renderUntrusted(
      [
        '<div id="injected"><b>bold</b></div>',
        '<script>alert(1)</script>',
        '<video src="https://x.example/v.mp4"></video>',
        '<img src="https://x.example/b.png">',
        '![a](https://x.example/a.png)',
      ].join('\n\n')
    )
    expect(el.querySelector('[id$="injected"]')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('script')).toBeNull()
    expect(el.textContent).not.toContain('alert(1)')
    expect(el.querySelectorAll('[src]')).toHaveLength(0)
  })
})

describe('Markdown that fetches nothing — still renders headings, lists, tables, task lists, quotes and code', () => {
  it('still renders headings, lists, tables, task lists, quotes and code', () => {
    const el = renderUntrusted(
      [
        '# One',
        '- outer\n  - inner',
        '1. first\n2. second',
        '| Name | Value |\n| --- | --- |\n| a | 1 |',
        '- [x] done\n- [ ] todo',
        '> quoted',
        '~~gone~~ **bold** _italic_',
        '```html\n<script>window.__pwned = 4</script>\n```',
      ].join('\n\n')
    )
    expect(el.querySelector('h1')?.textContent).toBe('One')
    expect(el.querySelectorAll('ul ul li')).toHaveLength(1)
    expect(el.querySelectorAll('ol li')).toHaveLength(2)
    expect(el.querySelectorAll('tbody td')).toHaveLength(2)
    const boxes = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(Array.from(boxes).map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ])
    expect(el.querySelector('blockquote')?.textContent?.trim()).toBe('quoted')
    expect(el.querySelector('del')?.textContent).toBe('gone')
    expect(el.querySelector('pre code')?.textContent).toContain('window.__pwned = 4')
    expect(el.querySelector('script')).toBeNull()
  })
})

describe('Markdown that fetches nothing — still opens a link through onOpenLink', () => {
  it('still opens a link through onOpenLink', () => {
    onOpenLink.mockClear()
    const anchor = renderUntrusted('[docs](https://example.com/docs)').querySelector('a')!
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/docs')
  })
})

// One line of text — a question, an option, a reason — that sits inside a button
// or a label, where a block element is invalid markup.
describe('inline Markdown', () => {
  function renderInline(body: string) {
    return render(
      <button type="button">
        <Markdown onOpenLink={onOpenLink} inline>
          {body}
        </Markdown>
      </button>
    ).container
  }

  it('renders code, bold, italic and links inside a span, with no block element', () => {
    const el = renderInline('Hide **done** in `Orders.tsx`, *not* [grey](https://e.example)')
    expect(el.querySelector('strong')?.textContent).toBe('done')
    expect(el.querySelector('code')?.textContent).toBe('Orders.tsx')
    expect(el.querySelector('em')?.textContent).toBe('not')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://e.example')
    expect(el.querySelector('button > span.tmui-markdown')).not.toBeNull()
    expect(el.querySelector('p, ul, ol, li, pre, div, h1, h2, blockquote, table')).toBeNull()
  })

  it('keeps the words of a block it does not draw', () => {
    const el = renderInline('# Heading\n\n- an item')
    expect(el.textContent).toContain('Heading')
    expect(el.textContent).toContain('an item')
  })

  it('shows no image', () => {
    expect(renderInline('see ![pixel](https://evil.example/p.png)').querySelector('img')).toBeNull()
  })
})
