import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { ActivitySpinner } from '../../src/renderer/components/ActivitySpinner'

describe('ActivitySpinner', () => {
  it('renders with role="status"', () => {
    render(<ActivitySpinner />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('has the base activity-spinner class', () => {
    render(<ActivitySpinner />)
    expect(screen.getByRole('status').classList.contains('activity-spinner')).toBe(true)
  })

  it('applies extra className when provided', () => {
    render(<ActivitySpinner className="my-class" />)
    const el = screen.getByRole('status')
    expect(el.classList.contains('activity-spinner')).toBe(true)
    expect(el.classList.contains('my-class')).toBe(true)
  })

  it('has accessible label', () => {
    render(<ActivitySpinner />)
    expect(screen.getByLabelText('Activity in progress')).toBeTruthy()
  })
})
