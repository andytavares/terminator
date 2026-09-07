import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { Markdown } from '../../src/components/Markdown.js'

// An issue's body is markdown and it was rendered into a `<p>`, which collapses
// every newline — so a real ticket arrived as
//
//   Problem. # Summary Make all text red # Context … # Acceptance Criteria - [ ]
//
// one unbroken line. The order's own words, made unreadable at the moment
// somebody most needs to read them.

const TICKET = [
  '# Summary',
  'Make all text in the application red',
  '',
  '# Acceptance Criteria',
  '- [ ] All text is red',
  '- [x] The heading is red',
  '',
  '# Dev Hints',
  '* Text should be `red`',
].join('\n')

describe('a ticket description', () => {
  it('keeps its headings apart instead of running them together', () => {
    render(<Markdown text={TICKET} />)
    expect(screen.getByText('Summary')).toBeTruthy()
    expect(screen.getByText('Acceptance Criteria')).toBeTruthy()
    expect(screen.getByText('Dev Hints')).toBeTruthy()
  })

  it('renders a list as a list', () => {
    const { container } = render(<Markdown text={TICKET} />)
    expect(container.querySelectorAll('li').length).toBe(3)
  })

  it('shows an acceptance checklist as checkboxes, ticked as written', () => {
    const { container } = render(<Markdown text={TICKET} />)
    const boxes = container.querySelectorAll('input[type="checkbox"]')
    expect(boxes.length).toBe(2)
    expect((boxes[0] as HTMLInputElement).checked).toBe(false)
    expect((boxes[1] as HTMLInputElement).checked).toBe(true)
    // Shown, never answered here: this is the ticket's text, not a control.
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true)
  })

  it('renders inline code, bold and italic', () => {
    const { container } = render(<Markdown text={'a `code` **bold** *italic* end'} />)
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
  })

  it('renders a fenced block whole, newlines and all', () => {
    const { container } = render(<Markdown text={'```\none\ntwo\n```'} />)
    expect(container.querySelector('pre code')?.textContent).toBe('one\ntwo')
  })

  it('shows nothing at all for an empty description', () => {
    const { container } = render(<Markdown text={'   '} />)
    expect(container.firstChild).toBeNull()
  })
})

// This text is written by whoever wrote the ticket. It is turned into React
// elements and never into markup, so there is no sanitiser to get wrong.
describe('a ticket written by somebody else', () => {
  it('shows script tags as the text they are', () => {
    const { container } = render(<Markdown text={'<script>alert(1)</script> after'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('does not make a javascript: link clickable', () => {
    const { container } = render(<Markdown text={'[click](javascript:alert(1))'} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('[click](javascript:alert(1))')
  })

  it('does not make a data: link clickable', () => {
    const { container } = render(<Markdown text={'[x](data:text/html,<script>1</script>)'} />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('links http and https, and opens them without handing over the opener', () => {
    const { container } = render(<Markdown text={'[the issue](https://example.com/x)'} />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/x')
    expect(link?.getAttribute('rel')).toContain('noopener')
  })

  it('shows an img tag as text rather than fetching it', () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
