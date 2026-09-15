import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StateIcon } from '../../../../src/renderer/components/session/StateIcon'
import type { AgentState } from '../../../../src/shared/types/index'

describe('StateIcon', () => {
  it.each([
    ['awaiting-input', 'Waiting on you', 'lucide-pause'],
    ['working', 'Running', 'lucide-play'],
    ['idle', 'Idle', 'lucide-circle'],
    ['exited', 'Exited', 'lucide-circle-x'],
  ] as Array<[AgentState, string, string]>)('draws %s as its own shape', (state, label, shape) => {
    render(<StateIcon state={state} />)
    const icon = screen.getByRole('img', { name: label })
    expect(icon.querySelector('svg')?.getAttribute('class')).toContain(shape)
    expect(icon.className).toContain(`state-icon--${state}`)
  })

  it('never colours the icon inline', () => {
    const { container } = render(<StateIcon state="awaiting-input" />)
    for (const node of container.querySelectorAll('*')) {
      expect((node as HTMLElement).style?.color ?? '').toBe('')
      expect(node.getAttribute('stroke') ?? 'currentColor').toBe('currentColor')
    }
  })
})
