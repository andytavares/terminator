import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RichContent } from '../../src/components/pr-review/RichContent'

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

vi.mock('remark-gfm', () => ({ default: () => {} }))

vi.mock('highlight.js', () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: '<span>highlighted</span>' }),
    highlightAuto: vi.fn().mockReturnValue({ value: '<span>auto</span>' }),
  },
}))

describe('RichContent', () => {
  it('renders children inside markdown component', () => {
    render(<RichContent>Hello world</RichContent>)
    expect(screen.getByTestId('markdown')).toBeTruthy()
    expect(screen.getByText('Hello world')).toBeTruthy()
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
})
