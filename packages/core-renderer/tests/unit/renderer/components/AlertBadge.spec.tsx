import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertBadge } from '../../../../src/components/AlertBadge'

describe('AlertBadge', () => {
  it('renders nothing when count is 0', () => {
    render(<AlertBadge count={0} />)
    expect(screen.queryByLabelText(/alert/)).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
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
})

describe('AlertBadge — has correct aria-label for multiple alerts', () => {
  it('has correct aria-label for multiple alerts', () => {
    render(<AlertBadge count={5} />)
    const badge = screen.getByLabelText('5 alerts')
    expect(badge).toBeTruthy()
  })

  it('applies className prop to rendered span', () => {
    render(<AlertBadge count={2} className="custom-class" />)
    expect(screen.getByLabelText('2 alerts').className).toContain('custom-class')
  })
})
