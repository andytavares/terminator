import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StateChip } from '../../../../src/components/session/StateChip'
import type { AgentState } from '../../../../../core-shared/src/types/index'

describe('StateChip', () => {
  it.each([
    ['awaiting-input', 'Waiting on you', 'lucide-pause'],
    ['working', 'Running', 'lucide-play'],
    ['idle', 'Idle', 'lucide-circle'],
    ['exited', 'Exited', 'lucide-circle-x'],
  ] as Array<[AgentState, string, string]>)(
    'draws %s as its own shape, labelled for a reader',
    (state, label, shape) => {
      render(<StateChip state={state} />)
      const chip = screen.getByRole('img', { name: label })
      expect(chip.innerHTML).toContain(`class="lucide ${shape}`)
      expect(chip.className).toContain(`state-chip--${state}`)
      expect(screen.getByText(label)).toBeTruthy()
    }
  )

  it('compact form drops the visible label but keeps the accessible name', () => {
    render(<StateChip state="awaiting-input" compact />)
    const chip = screen.getByRole('img', { name: 'Waiting on you' })
    expect(chip.className).toContain('state-chip--compact')
    expect(screen.queryByText('Waiting on you')).toBeNull()
  })

  it('never colours the glyph inline', () => {
    render(<StateChip state="awaiting-input" />)
    const markup = screen.getByRole('img', { name: 'Waiting on you' }).outerHTML
    expect(markup).not.toMatch(/style="[^"]*color/)
    const strokes = markup.match(/stroke="[^"]*"/g) ?? []
    expect(strokes.filter((stroke) => stroke !== 'stroke="currentColor"')).toEqual([])
  })
})
