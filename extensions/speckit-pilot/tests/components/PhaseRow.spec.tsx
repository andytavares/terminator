import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { PhaseRow } from '../../src/components/PhaseRow.js'
import type { PhaseStatus } from '../../src/types/speckit.types.js'

describe('PhaseRow', () => {
  const statuses: PhaseStatus[] = [
    'locked',
    'ready',
    'running',
    'awaiting_review',
    'approved',
    'stale',
    'modified',
    'failed',
  ]

  it.each(statuses)('renders glyph for status: %s', (status) => {
    render(<PhaseRow phaseId="constitution" status={status} />)
    // Component renders without throwing
    const el = screen.getByRole('button')
    expect(el).toBeTruthy()
  })

  it('renders lock icon for locked status', () => {
    const { container } = render(<PhaseRow phaseId="specify" status="locked" />)
    expect(container.textContent).toContain('🔒')
  })

  it('renders checkmark for approved status', () => {
    const { container } = render(<PhaseRow phaseId="plan" status="approved" />)
    expect(container.textContent).toContain('✓')
  })

  it('renders the phase id as the label', () => {
    render(<PhaseRow phaseId="implement" status="ready" />)
    expect(screen.getByRole('button').textContent).toContain('implement')
  })

  it('applies selected styling when isSelected=true', () => {
    const { container } = render(<PhaseRow phaseId="tasks" status="ready" isSelected={true} />)
    const el = container.firstChild as HTMLElement
    expect(el.style.background).not.toBe('transparent')
  })

  it('does not apply selected styling when isSelected=false', () => {
    const { container } = render(<PhaseRow phaseId="tasks" status="ready" isSelected={false} />)
    const el = container.firstChild as HTMLElement
    expect(el.style.background).toBe('transparent')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<PhaseRow phaseId="analyze" status="ready" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('calls onClick on Enter keydown', () => {
    const onClick = vi.fn()
    render(<PhaseRow phaseId="analyze" status="ready" onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders CTA slot when provided', () => {
    render(
      <PhaseRow
        phaseId="constitution"
        status="awaiting_review"
        cta={<button data-testid="approve-btn">Approve</button>}
      />
    )
    expect(screen.getByTestId('approve-btn')).toBeTruthy()
  })
})
