import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { RichContent } from '../../src/components/pr-review/RichContent'

const FENCE = '```'

describe('RichContent HTML in markdown', () => {
  it('renders allowed HTML as elements alongside markdown, highlighting and footnotes', () => {
    const body = [
      '**bold** text',
      '',
      '<details><summary>More</summary>hidden</details>',
      '',
      '<img src="https://example.com/shot.png" alt="shot">',
      '',
      'line one<br>line two and H<sub>2</sub>O',
      '',
      '| col a | col b |',
      '| ----- | ----- |',
      '| 1     | 2     |',
      '',
      `${FENCE}ts`,
      'const x: number = 1',
      FENCE,
      '',
      'See the note[^1].',
      '',
      '[^1]: The note.',
    ].join('\n')

    const { container } = render(<RichContent>{body}</RichContent>)

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.querySelector('summary')?.textContent).toBe('More')
    expect(details!.textContent).toContain('hidden')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/shot.png')
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.querySelector('sub')?.textContent).toBe('2')
    expect(container.textContent).not.toContain('<details>')
    expect(container.textContent).not.toContain('<img')

    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelectorAll('table td')).toHaveLength(2)

    const code = container.querySelector('code.hljs.language-ts')
    expect(code).not.toBeNull()
    expect(code!.querySelector('span')).not.toBeNull()

    const ref = container.querySelector('sup > a')
    expect(ref).not.toBeNull()
    const href = ref!.getAttribute('href')!
    expect(href.startsWith('#')).toBe(true)
    const target = container.querySelector(`[id="${href.slice(1)}"]`)
    expect(target).not.toBeNull()
    expect(target!.textContent).toContain('The note.')
  })

  it('strips scripts, event handlers, iframes and javascript: links', () => {
    const body = [
      'before',
      '',
      '<script>window.pwned = true</script>',
      '',
      '<img src="https://example.com/x.png" onerror="window.pwned = true">',
      '',
      '<p onclick="window.pwned = true">clickable</p>',
      '',
      '<iframe src="https://example.com"></iframe>',
      '',
      '<a href="javascript:window.pwned = true">bad link</a>',
      '',
      'after',
    ].join('\n')

    const { container } = render(<RichContent>{body}</RichContent>)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith('on')).toBe(false)
      }
    }
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i)
    }
    expect(container.textContent).toContain('before')
    expect(container.textContent).toContain('clickable')
    expect(container.textContent).toContain('bad link')
    expect(container.textContent).toContain('after')
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })

  it('prefixes HTML id and name so a body cannot clobber document properties', () => {
    const body = [
      '<img name="createElement" src="https://example.com/a.png">',
      '',
      '<img id="activeElement" src="https://example.com/b.png">',
    ].join('\n')

    const { container } = render(<RichContent>{body}</RichContent>)

    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('name')).toBe('user-content-createElement')
    expect(imgs[1].getAttribute('id')).toBe('user-content-activeElement')
    expect(typeof document.createElement).toBe('function')
    expect(document.activeElement?.tagName).not.toBe('IMG')
  })

  it('keeps in-page links in the view and stops other non-http links navigating it', () => {
    const body = [
      '[jump](#notes)',
      '',
      '[relative](docs/guide.md)',
      '',
      '[mail](mailto:a@example.com)',
    ].join('\n')

    const { getByText } = render(<RichContent>{body}</RichContent>)

    const jump = getByText('jump')
    expect(jump.getAttribute('href')).toBe('#user-content-notes')
    expect(fireEvent.click(jump)).toBe(true)
    expect(fireEvent.click(getByText('relative'))).toBe(false)
    expect(fireEvent.click(getByText('mail'))).toBe(false)
  })
})
