import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ChoiceButtons } from '../../../../src/renderer/components/session/ChoiceButtons'

const prompt = {
  question: 'Do you want to create a.txt?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'Yes, and switch to accept edits' },
    { number: 3, label: 'No' },
  ],
}

describe('ChoiceButtons', () => {
  it('draws one button per option, in order, grouped under the question', () => {
    render(<ChoiceButtons prompt={prompt} onAnswer={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Do you want to create a.txt?' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['1. Yes', '2. Yes, and switch to accept edits', '3. No'])
  })

  it('answers with the option number, without opening the tile it sits on', () => {
    const onAnswer = vi.fn()
    const tile = vi.fn()
    render(
      <div onClick={tile}>
        <ChoiceButtons prompt={prompt} onAnswer={onAnswer} />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: '3. No' }))
    expect(onAnswer).toHaveBeenCalledWith(3)
    expect(tile).not.toHaveBeenCalled()
  })

  it('does not bubble Enter to a tile that would open on it', () => {
    const tileKey = vi.fn()
    render(
      <div onKeyDown={tileKey}>
        <ChoiceButtons prompt={prompt} onAnswer={vi.fn()} />
      </div>
    )
    fireEvent.keyDown(screen.getByRole('button', { name: '1. Yes' }), { key: 'Enter' })
    expect(tileKey).not.toHaveBeenCalled()
  })
})
