import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChoiceButtons } from '../../../../src/components/session/ChoiceButtons'

const prompt = {
  question: 'Do you want to create a.txt?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'Yes, and switch to accept edits' },
    { number: 3, label: 'No' },
  ],
}

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

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

  it('answers with the option number, without opening the tile it sits on', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    const tile = vi.fn()
    render(
      <div onClick={tile}>
        <ChoiceButtons prompt={prompt} onAnswer={onAnswer} />
      </div>
    )
    await user.click(screen.getByRole('button', { name: '3. No' }))
    expect(onAnswer).toHaveBeenCalledWith(3)
    expect(tile).not.toHaveBeenCalled()
  })
})

describe('ChoiceButtons — does not bubble Enter to a tile that would open on it', () => {
  it('does not bubble Enter to a tile that would open on it', async () => {
    const user = userEvent.setup()
    const tileKey = vi.fn()
    render(
      <div onKeyDown={tileKey}>
        <ChoiceButtons prompt={prompt} onAnswer={vi.fn()} />
      </div>
    )
    const yes = screen.getByRole('button', { name: '1. Yes' })
    yes.focus()
    expect(yes.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(tileKey).not.toHaveBeenCalled()
  })
})
