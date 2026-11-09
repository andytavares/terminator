import React from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Markdown } from '../../src/Markdown'

const onOpenLink = vi.fn()

function renderBody(body: string) {
  return render(<Markdown onOpenLink={onOpenLink}>{body}</Markdown>).container
}

describe('Markdown before its HTML renderer has loaded', () => {
  it('shows no tag text and no unsafe element, then renders the HTML', async () => {
    vi.resetModules()
    const { Markdown: Fresh } = await import('../../src/Markdown')
    const el = render(
      <Fresh onOpenLink={onOpenLink}>
        {'<details><summary>Logs</summary>body</details>\n\n<script>alert(1)</script>'}
      </Fresh>
    ).container
    expect(el.textContent).not.toContain('<details>')
    expect(el.textContent).not.toContain('alert(1)')
    expect(el.innerHTML).not.toContain('<script')
    await waitFor(() => expect(within(el).getByText('Logs').tagName).toBe('SUMMARY'))
    expect(el.innerHTML).not.toContain('<script')
  })
})

/** The hooks every "Markdown raw HTML" describe registers. */
function setUpMarkdownRawHTML(): void {
  beforeAll(async () => {
    const el = renderBody('<sub>x</sub>')
    await waitFor(() => expect(within(el).getByText('x').tagName).toBe('SUB'))
  })

  beforeEach(() => {
    onOpenLink.mockClear()
  })
}

describe('Markdown raw HTML', () => {
  setUpMarkdownRawHTML()

  it('renders <details>/<summary> as a disclosure, not tag text', () => {
    const el = renderBody('<details><summary>Logs</summary>body</details>')
    const disclosure = within(el).getByRole('group')
    expect(within(disclosure).getByText('Logs').tagName).toBe('SUMMARY')
    expect(disclosure.textContent).toContain('body')
    expect(el.textContent).not.toContain('<details>')
    expect(el.textContent).not.toContain('<summary>')
  })

  it('renders <br> as a line break', () => {
    const el = renderBody('a<br>b')
    expect(el.innerHTML).toContain('<br>')
    expect(el.textContent).toBe('ab')
  })

  it('renders <sub> as an element', () => {
    const el = renderBody('<sub>x</sub>')
    expect(within(el).getByText('x').tagName).toBe('SUB')
    expect(el.textContent).not.toContain('<sub>')
  })

  it('links a GFM footnote reference to its definition', () => {
    const el = renderBody('text[^1]\n\n[^1]: note')
    const href = within(el).getByRole('link', { name: '1' }).getAttribute('href') ?? ''
    const note = within(el).getByRole('listitem')
    expect(href).toBe(`#${note.id}`)
    expect(note.textContent).toContain('note')
    expect(href).not.toContain('user-content-user-content-')
  })
})

describe('Markdown raw HTML — leaves a fenced block as plain code when no code renderer is given', () => {
  setUpMarkdownRawHTML()

  it('leaves a fenced block as plain code when no code renderer is given', () => {
    const el = renderBody('```js\nconst a = 1\n```')
    const code = within(el).getByText('const a = 1')
    expect(code.tagName).toBe('CODE')
    expect(code.className).toBe('language-js')
    expect(code.textContent).toBe('const a = 1\n')
  })
})

describe('Markdown raw HTML — a code renderer', () => {
  setUpMarkdownRawHTML()

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
    expect(within(el).getByText('const a = 1').getAttribute('data-language')).toBe('js')
  })

  it('keeps inline code out of the code renderer', () => {
    const renderCode = vi.fn(() => <b />)
    const el = render(
      <Markdown onOpenLink={onOpenLink} renderCode={renderCode}>
        {'use `npm ci` here'}
      </Markdown>
    ).container
    expect(renderCode).not.toHaveBeenCalled()
    expect(within(el).getByText('npm ci').tagName).toBe('CODE')
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
    expect(el.innerHTML).not.toMatch(/<(script|iframe|style)\b/i)
    expect(el.textContent).not.toContain('alert(1)')
    expect(el.textContent).not.toContain('display:none')
    expect(el.textContent).toContain('after')
  })

  it('strips on* handlers from an allowed element', () => {
    const el = renderBody('<img src="https://example.com/a.png" onerror="alert(1)">')
    expect(within(el).getByRole('img').getAttribute('src')).toBe('https://example.com/a.png')
    expect(el.innerHTML).not.toMatch(/\son\w+=/i)
  })
})

describe('Markdown raw HTML — sanitising — removes javascript: hrefs', () => {
  setUpMarkdownRawHTML()

  it('removes javascript: hrefs', () => {
    const el = renderBody('<a href="javascript:alert(1)">click</a>')
    expect(el.innerHTML.toLowerCase()).not.toContain('javascript:')
  })

  it('prefixes every id and name so a body cannot clobber document members', () => {
    const el = renderBody(
      '<img name="createElement" src="https://example.com/a.png">\n\n<div id="getElementById">x</div>\n\ntext[^1]\n\n[^1]: note'
    )
    const values = [...el.innerHTML.matchAll(/\s(?:id|name)="([^"]*)"/g)].map((match) => match[1])
    expect(values).toContain('user-content-createElement')
    expect(values).toContain('user-content-getElementById')
    expect(values.every((v) => v?.startsWith('user-content-'))).toBe(true)
    expect(values.some((v) => v?.startsWith('user-content-user-content-'))).toBe(false)
    expect(document).toHaveProperty('createElement', expect.any(Function))
    expect(document).toHaveProperty('getElementById', expect.any(Function))
  })
})

describe('Markdown raw HTML — sanitising — points an in-page HTML anchor at the prefixed id', () => {
  setUpMarkdownRawHTML()

  it('points an in-page HTML anchor at the prefixed id', () => {
    const el = renderBody('<a href="#notes">jump</a>\n\n<h3 id="notes">Notes</h3>')
    expect(within(el).getByRole('link', { name: 'jump' }).getAttribute('href')).toBe(
      '#user-content-notes'
    )
    expect(within(el).getByRole('heading', { name: 'Notes' }).id).toBe('user-content-notes')
  })

  it('opens an HTML <a href="https://…"> through onOpenLink', () => {
    const el = renderBody('<a href="https://example.com/pr">PR</a>')
    const link = within(el).getByRole('link', { name: 'PR' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/pr')
    expect(event.defaultPrevented).toBe(true)
  })
})

const renderedLink = (body: string) => {
  const { container } = render(<Markdown onOpenLink={onOpenLink}>{body}</Markdown>)
  return within(container).getByRole('link')
}

const clickAnchor = (anchor: Element) => {
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
    const event = clickAnchor(renderedLink('[PR](https://example.com/pr)'))
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/pr')
    expect(event.defaultPrevented).toBe(true)
  })

  it('opens an http address through onOpenLink', () => {
    clickAnchor(renderedLink('[PR](http://example.com/pr)'))
    expect(onOpenLink).toHaveBeenCalledWith('http://example.com/pr')
  })

  it('lets an in-page link scroll the view', () => {
    const anchor = renderedLink('[jump](#section)')
    expect(clickAnchor(anchor).defaultPrevented).toBe(false)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('points an in-page link at the prefixed id the sanitiser gives the target', () => {
    expect(renderedLink('[jump](#section)').getAttribute('href')).toBe('#user-content-section')
  })

  it('leaves an already-prefixed in-page link alone', () => {
    expect(renderedLink('[jump](#user-content-section)').getAttribute('href')).toBe(
      '#user-content-section'
    )
  })

  it('keeps a relative href from navigating the view', () => {
    const event = clickAnchor(renderedLink('[x](./relative/path)'))
    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).not.toHaveBeenCalled()
  })
})

describe('Markdown links — keeps a protocol-relative href from navigating the view', () => {
  setUpMarkdownLinks()

  it('keeps a protocol-relative href from navigating the view', () => {
    const event = clickAnchor(renderedLink('[x](//evil.example/x)'))
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
  beforeEach(() => onOpenLink.mockClear())

  it('opens a mailto address through onOpenLink', () => {
    const event = clickAnchor(
      within(renderBody('[mail](mailto:team@example.com)')).getByText('mail')
    )
    expect(onOpenLink).toHaveBeenCalledWith('mailto:team@example.com')
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps a link with no destination from reloading the view', () => {
    const event = clickAnchor(within(renderBody('[empty]()')).getByText('empty'))
    expect(event.defaultPrevented).toBe(true)
    expect(onOpenLink).not.toHaveBeenCalled()
  })

  it('leaves a javascript: link inert', () => {
    const anchor = within(renderBody('[click me](javascript:window.__pwned=3)')).getByText(
      'click me'
    )
    expect(clickAnchor(anchor).defaultPrevented).toBe(true)
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
    expect(el.innerHTML).not.toContain('<img')
    expect(el.innerHTML).not.toContain('evil.example')
  })

  it('renders no raw HTML and no src attribute, even once the HTML renderer has loaded', async () => {
    const warm = renderBody('<sub>warm</sub>')
    await waitFor(() => expect(within(warm).getByText('warm').tagName).toBe('SUB'))
    const el = renderUntrusted(
      [
        '<div id="injected"><b>bold</b></div>',
        '<script>alert(1)</script>',
        '<video src="https://x.example/v.mp4"></video>',
        '<img src="https://x.example/b.png">',
        '![a](https://x.example/a.png)',
      ].join('\n\n')
    )
    expect(el.innerHTML).not.toContain('injected')
    expect(el.innerHTML).not.toMatch(/<(b|script)\b/i)
    expect(el.textContent).not.toContain('alert(1)')
    expect(el.innerHTML).not.toContain(' src=')
  })
})

const EVERY_BLOCK = [
  '# One',
  '- outer\n  - inner',
  '1. first\n2. second',
  '| Name | Value |\n| --- | --- |\n| a | 1 |',
  '- [x] done\n- [ ] todo',
  '> quoted',
  '~~gone~~ **bold** _italic_',
  '```html\n<script>window.__pwned = 4</script>\n```',
]

describe('Markdown that fetches nothing — still renders headings, lists, tables, task lists, quotes and code', () => {
  it('still renders headings, lists, tables, task lists, quotes and code', () => {
    const el = renderUntrusted(EVERY_BLOCK.join('\n\n'))
    const view = within(el)
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('One')
    expect(within(view.getByText('outer')).getAllByRole('listitem')).toHaveLength(1)
    const ordered = view.getAllByRole('list').filter((list) => list.tagName === 'OL')
    expect(within(ordered[0]).getAllByRole('listitem')).toHaveLength(2)
    expect(view.getAllByRole('cell')).toHaveLength(2)
    const boxes = view.getAllByRole<HTMLInputElement>('checkbox')
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ])
    expect(view.getByRole('blockquote').textContent?.trim()).toBe('quoted')
    expect(view.getByRole('deletion').textContent).toBe('gone')
    expect(view.getByText(/window.__pwned = 4/).tagName).toBe('CODE')
    expect(el.innerHTML).not.toContain('<script')
  })
})

describe('Markdown that fetches nothing — still opens a link through onOpenLink', () => {
  it('still opens a link through onOpenLink', () => {
    onOpenLink.mockClear()
    const anchor = within(renderUntrusted('[docs](https://example.com/docs)')).getByRole('link', {
      name: 'docs',
    })
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/docs')
  })
})

function renderInlineMarkdown(body: string) {
  return render(
    <button type="button">
      <Markdown onOpenLink={onOpenLink} inline>
        {body}
      </Markdown>
    </button>
  ).container
}

// One line of text — a question, an option, a reason — that sits inside a button
// or a label, where a block element is invalid markup.
describe('inline Markdown', () => {
  it('renders code, bold, italic and links inside a span, with no block element', () => {
    const el = renderInlineMarkdown(
      'Hide **done** in `Orders.tsx`, *not* [grey](https://e.example)'
    )
    expect(within(el).getByText('done').tagName).toBe('STRONG')
    expect(within(el).getByText('Orders.tsx').tagName).toBe('CODE')
    expect(within(el).getByText('not').tagName).toBe('EM')
    expect(within(el).getByRole('link', { name: 'grey' }).getAttribute('href')).toBe(
      'https://e.example'
    )
    expect(within(el).getByRole('button').innerHTML).toMatch(/^<span class="tmui-markdown/)
    expect(el.innerHTML).not.toMatch(/<(p|ul|ol|li|pre|div|h1|h2|blockquote|table)[\s>]/)
  })

  it('keeps the words of a block it does not draw', () => {
    const el = renderInlineMarkdown('# Heading\n\n- an item')
    expect(el.textContent).toContain('Heading')
    expect(el.textContent).toContain('an item')
  })

  it('shows no image', () => {
    expect(
      renderInlineMarkdown('see ![pixel](https://evil.example/p.png)').innerHTML
    ).not.toContain('<img')
  })
})

// An agent's reply: raw HTML is drawn, but nothing is fetched from the network.
describe('offline Markdown', () => {
  setUpMarkdownRawHTML()

  it('renders raw HTML but keeps no src, so no image or video loads', () => {
    const el = render(
      <Markdown onOpenLink={onOpenLink} offline>
        {[
          '<details><summary>Logs</summary>body</details>',
          '<img src="https://x.example/b.png">',
          '<video src="https://x.example/v.mp4"></video>',
          '![a](https://x.example/a.png)',
        ].join('\n\n')}
      </Markdown>
    ).container
    expect(within(within(el).getByRole('group')).getByText('Logs').tagName).toBe('SUMMARY')
    expect(el.innerHTML).not.toContain('<img')
    expect(el.innerHTML).not.toContain(' src=')
    expect(el.innerHTML).not.toContain('x.example')
  })
})

describe('Markdown raw HTML — inline SVG', () => {
  setUpMarkdownRawHTML()

  it('draws a chart made of shapes and text', () => {
    const el = renderBody(
      '<svg viewBox="0 0 100 50" width="100" height="50"><rect x="0" y="10" width="40" height="40" fill="teal"></rect><text x="2" y="8">Q1</text></svg>'
    )
    expect(el.innerHTML).toContain('<svg viewBox="0 0 100 50"')
    expect(el.innerHTML).toContain('<rect x="0" y="10" width="40" height="40" fill="teal">')
    expect(within(el).getByText('Q1').tagName).toBe('text')
  })

  it('drops scripts, handlers, javascript: links, foreign objects and styles from an SVG', () => {
    const el = renderBody(
      '<svg onload="alert(1)" style="x"><script>alert(2)</script><a href="javascript:alert(3)"><circle r="4"></circle></a><foreignObject><div>html</div></foreignObject><use href="#x"></use></svg>'
    )
    expect(el.innerHTML).toContain('<svg')
    expect(el.innerHTML).not.toMatch(/<(script|foreignObject|use)[\s>]/i)
    expect(el.innerHTML).not.toContain('javascript:')
    expect(el.innerHTML).not.toContain('onload')
    expect(el.innerHTML).not.toContain('style=')
    expect(el.textContent).not.toContain('alert')
  })
})

describe('Markdown — an HTML title is never kept', () => {
  it('drops every title, so a body cannot rename the window', async () => {
    const view = render(
      <Markdown offline onOpenLink={() => {}}>
        {'<title>Hijack</title>\n\n<svg viewBox="0 0 10 10"><title>Chart</title></svg>'}
      </Markdown>
    )
    // The HTML plugins load lazily: until the SVG exists, the body is still plain text.
    await waitFor(() => expect(view.container.innerHTML).toContain('<svg'))
    // React moves a title outside an SVG into document.head, so look at the whole document.
    expect(document.documentElement.innerHTML).not.toContain('<title>Hijack')
  })
})

describe('Markdown when the view around it re-renders', () => {
  it('keeps the same link element, which then opens through the newest onOpenLink', async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const body = '[docs](https://e.example/d)'
    const { rerender } = render(
      <Markdown onOpenLink={first} fetchesNothing>
        {body}
      </Markdown>
    )
    const link = screen.getByRole('link', { name: 'docs' })
    rerender(
      <Markdown onOpenLink={latest} fetchesNothing>
        {body}
      </Markdown>
    )
    expect(screen.getByRole('link', { name: 'docs' })).toBe(link)
    await userEvent.setup().click(link)
    expect(latest).toHaveBeenCalledWith('https://e.example/d')
    expect(first).not.toHaveBeenCalled()
  })
})
