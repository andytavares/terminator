import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { CardTile } from '../../src/components/CardTile.js'
import type { CardSummary } from '../../src/types/speckit.types.js'

function card(over: Partial<CardSummary> = {}): CardSummary {
  return {
    featureDir: '/repo/specs/016-demo',
    title: 'Demo card',
    type: 'feature',
    scopeLine: 'Do the thing',
    source: 'native',
    sourceUrl: null,
    sourceKey: null,
    stage: 'backlog',
    runStatus: 'none',
    phaseSummary: { done: 0, total: 10, awaitingReview: false },
    prUrl: null,
    ...over,
  }
}

describe('CardTile', () => {
  it('renders title, type badge and scope', () => {
    render(<CardTile card={card()} onOpen={vi.fn()} />)
    expect(screen.getByText('Demo card')).toBeTruthy()
    expect(screen.getByText('feature')).toBeTruthy()
    expect(screen.getByText('Do the thing')).toBeTruthy()
  })

  // The run-status chip repeated the name of the column the card was already
  // sitting in. What a card cannot say from its position is what happens next,
  // so that is what it says now.
  it('says what happens next rather than repeating its column', () => {
    render(
      <CardTile
        card={card({
          runStatus: 'awaiting_review',
          phaseSummary: { done: 3, total: 10, awaitingReview: true },
        })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Review plan')).toBeTruthy()
    expect(screen.queryByText('Needs review')).toBeNull()
  })

  it('names the phase, so reading the board needs no memorised numbering', () => {
    render(
      <CardTile
        card={card({ phaseSummary: { done: 3, total: 10, awaitingReview: false } })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Next: plan')).toBeTruthy()
  })

  it('shows how far it has got, and the comment count', () => {
    render(
      <CardTile
        card={card({ phaseSummary: { done: 3, total: 10, awaitingReview: false } })}
        commentCount={2}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('3 of 10')).toBeTruthy()
    expect(screen.getByLabelText('2 comments')).toBeTruthy()
  })

  it('exposes progress to assistive technology as a real progressbar', () => {
    render(
      <CardTile
        card={card({ phaseSummary: { done: 3, total: 10, awaitingReview: false } })}
        onOpen={vi.fn()}
      />
    )
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('10')
  })

  // The literal string "# Summary" was the description on every card.
  it("shows prose rather than the brief's raw markup", () => {
    render(
      <CardTile
        card={card({ scopeLine: '# Summary\nEvery surface reads one token.' })}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('Every surface reads one token.')).toBeTruthy()
    expect(screen.queryByText('# Summary')).toBeNull()
  })

  it('links out to the origin ticket for imported cards', () => {
    render(
      <CardTile
        card={card({
          source: 'linear',
          sourceKey: 'ENG-42',
          sourceUrl: 'https://linear.app/x/ENG-42',
        })}
        onOpen={vi.fn()}
      />
    )
    const link = screen.getByText('ENG-42').closest('a') as HTMLAnchorElement
    expect(link.href).toBe('https://linear.app/x/ENG-42')
  })

  it('shows a plain native origin with no link', () => {
    render(<CardTile card={card()} onOpen={vi.fn()} />)
    const origin = screen.getByText('native')
    expect(origin.closest('a')).toBeNull()
  })

  it('calls onOpen with the featureDir when clicked', () => {
    const onOpen = vi.fn()
    render(<CardTile card={card()} onOpen={onOpen} />)
    fireEvent.click(screen.getByTestId('card-tile-/repo/specs/016-demo'))
    expect(onOpen).toHaveBeenCalledWith('/repo/specs/016-demo')
  })
})
