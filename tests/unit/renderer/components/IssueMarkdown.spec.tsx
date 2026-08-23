import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IssueMarkdown } from '../../../../src/renderer/components/integrations/IssueMarkdown'

const openExternal = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: { shell: { openExternal } },
    writable: true,
    configurable: true,
  })
  delete (window as unknown as Record<string, unknown>).__pwned
})

// ── Security ────────────────────────────────────────────────────────────────
//
// Issue content is untrusted remote text: anyone who can comment on a ticket
// can put anything here. Every failure in this block is a release blocker.

describe('IssueMarkdown — security (FR-015)', () => {
  it('does not execute a script tag', () => {
    render(<IssueMarkdown>{'<script>window.__pwned = 1</script>'}</IssueMarkdown>)
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
    expect(document.querySelector('script')).toBeNull()
  })

  it('does not create an element with an inline event handler', () => {
    render(<IssueMarkdown>{'<img src=x onerror="window.__pwned = 2">'}</IssueMarkdown>)
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
    expect(document.querySelector('img')).toBeNull()
  })

  it('does not render raw HTML at all', () => {
    const { container } = render(
      <IssueMarkdown>{'<div id="injected"><b>bold</b></div>'}</IssueMarkdown>
    )
    expect(container.querySelector('#injected')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it('does not render an iframe', () => {
    render(<IssueMarkdown>{'<iframe src="https://evil.example"></iframe>'}</IssueMarkdown>)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('leaves a javascript: link inert', () => {
    render(<IssueMarkdown>{'[click me](javascript:window.__pwned=3)'}</IssueMarkdown>)
    const link = screen.getByText('click me').closest('a')
    fireEvent.click(link as Element)

    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
    expect(link?.getAttribute('href')).not.toContain('javascript:')
    expect(openExternal).not.toHaveBeenCalledWith(expect.stringContaining('javascript:'))
  })

  it('issues no network request for a remote image', () => {
    const { container } = render(
      <IssueMarkdown>{'![tracker](https://evil.example/pixel.png)'}</IssueMarkdown>
    )
    // A remote image in an issue body is a tracking pixel pointed at whoever
    // opens the ticket. Nothing with a src may survive.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[src]')).toBeNull()
    expect(container.innerHTML).not.toContain('evil.example')
  })

  it('renders no src attribute anywhere, whatever the source says', () => {
    const { container } = render(
      <IssueMarkdown>
        {'![a](https://x.example/a.png)\n\n<video src="https://x.example/v.mp4"></video>'}
      </IssueMarkdown>
    )
    expect(container.querySelectorAll('[src]')).toHaveLength(0)
  })

  it('does not execute anything hidden in a code fence', () => {
    render(<IssueMarkdown>{'```html\n<script>window.__pwned = 4</script>\n```'}</IssueMarkdown>)
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
    // It is shown as text, which is the whole point of a code fence.
    expect(screen.getByText(/window.__pwned = 4/)).toBeTruthy()
  })
})

// ── Rendering ───────────────────────────────────────────────────────────────

describe('IssueMarkdown — rendering (FR-014)', () => {
  it('renders headings as headings', () => {
    const { container } = render(<IssueMarkdown>{'# One\n\n## Two\n\n### Three'}</IssueMarkdown>)
    expect(container.querySelector('h1')?.textContent).toBe('One')
    expect(container.querySelector('h2')?.textContent).toBe('Two')
    expect(container.querySelector('h3')?.textContent).toBe('Three')
    expect(container.textContent).not.toContain('#')
  })

  it('renders an unordered list', () => {
    const { container } = render(<IssueMarkdown>{'- alpha\n- beta'}</IssueMarkdown>)
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.textContent).not.toContain('- alpha')
  })

  it('renders an ordered list', () => {
    const { container } = render(<IssueMarkdown>{'1. first\n2. second'}</IssueMarkdown>)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
  })

  it('renders a nested list', () => {
    const { container } = render(<IssueMarkdown>{'- outer\n  - inner'}</IssueMarkdown>)
    expect(container.querySelectorAll('ul ul li')).toHaveLength(1)
  })

  it('renders a task list as checkboxes', () => {
    const { container } = render(
      <IssueMarkdown>{'- [x] done thing\n- [ ] todo thing'}</IssueMarkdown>
    )
    const boxes = container.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect((boxes[0] as HTMLInputElement).checked).toBe(true)
    expect((boxes[1] as HTMLInputElement).checked).toBe(false)
    expect(container.textContent).not.toContain('[x]')
  })

  it('renders a table', () => {
    const { container } = render(
      <IssueMarkdown>{'| Name | Value |\n| --- | --- |\n| a | 1 |'}</IssueMarkdown>
    )
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody td')).toHaveLength(2)
    expect(container.textContent).not.toContain('| --- |')
  })

  it('renders a block quote', () => {
    const { container } = render(<IssueMarkdown>{'> quoted'}</IssueMarkdown>)
    expect(container.querySelector('blockquote')?.textContent?.trim()).toBe('quoted')
  })

  it('renders inline code', () => {
    const { container } = render(<IssueMarkdown>{'use `npm test` first'}</IssueMarkdown>)
    expect(container.querySelector('code')?.textContent).toBe('npm test')
    expect(container.textContent).not.toContain('`')
  })

  it('renders a fenced code block', () => {
    const { container } = render(<IssueMarkdown>{'```ts\nconst a = 1\n```'}</IssueMarkdown>)
    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1')
    expect(container.textContent).not.toContain('```')
  })

  it('renders emphasis', () => {
    const { container } = render(<IssueMarkdown>{'**bold** and _italic_'}</IssueMarkdown>)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.textContent).not.toContain('**')
  })

  it('renders strikethrough', () => {
    const { container } = render(<IssueMarkdown>{'~~gone~~'}</IssueMarkdown>)
    expect(container.querySelector('del')?.textContent).toBe('gone')
  })

  it('renders a link as a link', () => {
    render(<IssueMarkdown>{'[the docs](https://example.com/docs)'}</IssueMarkdown>)
    const link = screen.getByText('the docs').closest('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/docs')
  })

  it('leaves no literal markup visible for a description using everything', () => {
    const { container } = render(
      <IssueMarkdown>
        {
          '## Summary\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nx\n```\n\n**bold** [link](https://e.example)'
        }
      </IssueMarkdown>
    )
    const text = container.textContent ?? ''
    for (const markup of ['##', '```', '| --- |', '**']) {
      expect(text).not.toContain(markup)
    }
  })

  it('renders nothing at all for empty content', () => {
    const { container } = render(<IssueMarkdown>{''}</IssueMarkdown>)
    expect(container.querySelector('.issue-markdown')?.textContent).toBe('')
  })
})

// ── Links (FR-016) ──────────────────────────────────────────────────────────

describe('IssueMarkdown — links open externally', () => {
  it('opens in the browser rather than navigating', () => {
    render(<IssueMarkdown>{'[docs](https://example.com/docs)'}</IssueMarkdown>)
    const link = screen.getByText('docs').closest('a') as HTMLAnchorElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)

    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    // Default prevented: the app must not follow the link itself.
    expect(event.defaultPrevented).toBe(true)
  })

  it('does nothing for a link with no destination', () => {
    render(<IssueMarkdown>{'[empty]()'}</IssueMarkdown>)
    fireEvent.click(screen.getByText('empty').closest('a') as Element)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('survives a renderer with no shell bridge', () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {},
      writable: true,
      configurable: true,
    })
    render(<IssueMarkdown>{'[docs](https://example.com)'}</IssueMarkdown>)
    expect(() => fireEvent.click(screen.getByText('docs').closest('a') as Element)).not.toThrow()
  })
})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__pwned
})
