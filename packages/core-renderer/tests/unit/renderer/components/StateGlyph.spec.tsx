import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StateGlyph } from '../../../../src/components/home/StateGlyph'
import { STATE_LABELS, TASK_STATES } from '../../../../src/home/task-state'

describe('StateGlyph', () => {
  it.each(TASK_STATES)('names the %s state for assistive technology', (state) => {
    render(<StateGlyph state={state} />)
    expect(screen.getByRole('img', { name: STATE_LABELS[state] })).toBeTruthy()
  })

  it('says a guessed ask is inferred, and draws it with a dashed outline', () => {
    render(<StateGlyph state="needs-you" inferred />)
    const glyph = screen.getByRole('img', { name: 'Needs you, inferred' })
    expect(glyph.innerHTML).toContain('stroke-dasharray=')
  })

  it('draws every state with its own shape, so none depends on colour alone', () => {
    const shapes = TASK_STATES.map((state) => {
      const { unmount } = render(<StateGlyph state={state} />)
      const markup = screen.getByRole('img').innerHTML
      unmount()
      return markup
    })
    expect(new Set(shapes).size).toBe(TASK_STATES.length)
  })
})
