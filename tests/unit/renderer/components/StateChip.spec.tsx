import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StateChip } from '../../../../src/renderer/components/session/StateChip'
import type { AgentState } from '../../../../src/shared/types/index'

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
      expect(chip.querySelector('svg')?.getAttribute('class')).toContain(shape)
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
    const { container } = render(<StateChip state="awaiting-input" />)
    for (const node of container.querySelectorAll('*')) {
      expect((node as HTMLElement).style?.color ?? '').toBe('')
      expect(node.getAttribute('stroke') ?? 'currentColor').toBe('currentColor')
    }
  })
})
