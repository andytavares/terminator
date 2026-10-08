import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RichContent } from '../../src/components/pr-review/RichContent'

const mockOpenExternal = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../../src/utils/hljs', () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: '<span>highlighted</span>' }),
    highlightAuto: vi.fn().mockReturnValue({ value: '<span>auto</span>' }),
  },
}))

vi.mock('remark-gfm', () => ({ default: () => {} }))

// Render an anchor using whatever `a` component override is provided so we
// can test the click behaviour of the custom handler.
type AnchorProps = { href?: string; children: React.ReactNode }
type MarkdownProps = {
  children: string
  components?: { a?: React.ComponentType<AnchorProps>; [key: string]: unknown }
}
vi.mock('react-markdown', () => ({
  default: ({ children, components }: MarkdownProps) => {
    const Anchor = components?.a
    return (
      <div data-testid="markdown">
        {Anchor ? <Anchor href={children}>link text</Anchor> : children}
      </div>
    )
  },
}))

Object.defineProperty(window, 'electronAPI', {
  writable: true,
  value: { shell: { openExternal: mockOpenExternal } },
})

describe('RichContent', () => {
  beforeEach(() => {
    mockOpenExternal.mockClear()
  })

  it('renders children inside markdown component', () => {
    render(<RichContent>Hello world</RichContent>)
    expect(screen.getByTestId('markdown')).toBeTruthy()
  })

  it('applies rich-content class', () => {
    const { container } = render(<RichContent>Content</RichContent>)
    expect(container.querySelector('.rich-content')).toBeTruthy()
  })

  it('applies additional className when provided', () => {
    const { container } = render(<RichContent className="extra">Content</RichContent>)
    expect(container.querySelector('.rich-content.extra')).toBeTruthy()
  })

  it('does not add extra class when className is not provided', () => {
    const { container } = render(<RichContent>Content</RichContent>)
    const el = container.querySelector('.rich-content')
    expect(el?.className).toBe('rich-content')
  })

  describe('anchor click handling', () => {
    it('calls openExternal and prevents default for https URLs', () => {
      render(<RichContent>{'https://example.com'}</RichContent>)
      const link = screen.getByRole('link')
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
      expect(event.defaultPrevented).toBe(true)
    })

    it('calls openExternal for http:// URLs', () => {
      render(<RichContent>{'http://example.com'}</RichContent>)
      const link = screen.getByRole('link')
      fireEvent.click(link)
      expect(mockOpenExternal).toHaveBeenCalledWith('http://example.com')
    })

    it('does not call openExternal for hash-only anchors', () => {
      render(<RichContent>{'#section'}</RichContent>)
      const link = screen.getByRole('link')
      fireEvent.click(link)
      expect(mockOpenExternal).not.toHaveBeenCalled()
    })

    it('prefixes an in-page hash href to match the sanitised id', () => {
      render(<RichContent>{'#section'}</RichContent>)
      expect(screen.getByRole('link').getAttribute('href')).toBe('#user-content-section')
    })

    it('leaves an already-prefixed hash href alone', () => {
      render(<RichContent>{'#user-content-section'}</RichContent>)
      expect(screen.getByRole('link').getAttribute('href')).toBe('#user-content-section')
    })

    it('keeps a relative href from navigating the view', () => {
      render(<RichContent>{'./relative/path'}</RichContent>)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      screen.getByRole('link').dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    })

    it('keeps a protocol-relative href from navigating the view', () => {
      render(<RichContent>{'//evil.example/x'}</RichContent>)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      screen.getByRole('link').dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(mockOpenExternal).not.toHaveBeenCalled()
    })

    it('lets an in-page hash link scroll the view', () => {
      render(<RichContent>{'#section'}</RichContent>)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      screen.getByRole('link').dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not call openExternal for relative hrefs', () => {
      render(<RichContent>{'./relative/path'}</RichContent>)
      const link = screen.getByRole('link')
      fireEvent.click(link)
      expect(mockOpenExternal).not.toHaveBeenCalled()
    })
  })
})
