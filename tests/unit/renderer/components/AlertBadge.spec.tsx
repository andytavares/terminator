import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertBadge } from '../../../../src/renderer/components/AlertBadge'

describe('AlertBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<AlertBadge count={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when count is negative', () => {
    const { container } = render(<AlertBadge count={-1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders count when count is positive', () => {
    render(<AlertBadge count={3} />)
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('shows 99+ when count exceeds 99', () => {
    render(<AlertBadge count={100} />)
    expect(screen.getByText('99+')).toBeTruthy()
  })

  it('shows exact count at 99', () => {
    render(<AlertBadge count={99} />)
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('has correct aria-label for single alert', () => {
    render(<AlertBadge count={1} />)
    const badge = screen.getByLabelText('1 alert')
    expect(badge).toBeTruthy()
  })

  it('has correct aria-label for multiple alerts', () => {
    render(<AlertBadge count={5} />)
    const badge = screen.getByLabelText('5 alerts')
    expect(badge).toBeTruthy()
  })

  it('applies className prop to rendered span', () => {
    const { container } = render(<AlertBadge count={2} className="custom-class" />)
    const span = container.querySelector('span')
    expect(span?.className).toContain('custom-class')
  })

  it('applies alert-badge class by default', () => {
    const { container } = render(<AlertBadge count={1} />)
    const span = container.querySelector('span')
    expect(span?.className).toContain('alert-badge')
  })
})
