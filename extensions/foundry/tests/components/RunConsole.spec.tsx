import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { RunConsole } from '../../src/components/RunConsole.js'

const md = ['# Heading', '', 'Some **bold** text']

describe('RunConsole', () => {
  it('renders lines as plain text by default (raw markdown shown literally)', () => {
    render(<RunConsole featureDir="/f" lines={md} />)
    const pre = screen.getByLabelText('run console')
    expect(pre.textContent).toContain('# Heading')
    expect(pre.textContent).toContain('Some **bold** text')
  })

  it('shows a Text/Markdown render toggle', () => {
    render(<RunConsole featureDir="/f" lines={md} />)
    expect(screen.getByRole('button', { name: /text/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /markdown/i })).toBeTruthy()
  })

  it('renders the output as formatted markdown when Markdown is selected', () => {
    const { container } = render(<RunConsole featureDir="/f" lines={md} />)
    fireEvent.click(screen.getByRole('button', { name: /markdown/i }))
    const rendered = container.querySelector('.sk-markdown')
    expect(rendered).toBeTruthy()
    expect(rendered!.querySelector('h1')?.textContent).toBe('Heading')
    expect(rendered!.querySelector('strong')?.textContent).toBe('bold')
    // raw markdown source is no longer shown verbatim
    expect(screen.queryByLabelText('run console')).toBeNull()
  })

  it('switches back to plain text when Text is selected', () => {
    render(<RunConsole featureDir="/f" lines={md} />)
    fireEvent.click(screen.getByRole('button', { name: /markdown/i }))
    fireEvent.click(screen.getByRole('button', { name: /text/i }))
    expect(screen.getByLabelText('run console').textContent).toContain('# Heading')
  })

  it('marks the active mode with aria-pressed', () => {
    render(<RunConsole featureDir="/f" lines={md} />)
    expect(screen.getByRole('button', { name: /text/i }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /markdown/i }))
    expect(screen.getByRole('button', { name: /markdown/i }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('shows the waiting placeholder when there is no output', () => {
    render(<RunConsole featureDir="/f" lines={[]} />)
    expect(screen.getByText('Waiting for output…')).toBeTruthy()
  })

  it('shows the phase label when provided', () => {
    render(<RunConsole featureDir="/f" lines={md} phase="specify" />)
    expect(screen.getByText('Specify')).toBeTruthy()
  })
})
