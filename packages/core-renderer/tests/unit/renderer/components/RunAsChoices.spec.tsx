// @vitest-environment jsdom
import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RunAsChoices } from '../../../../src/components/home/RunAsChoices'
import type { RunAs, RunAsOption } from '../../../../src/components/home/start-work'

const options: RunAsOption[] = [
  { value: 'agent', label: 'Claude in an agent tab', hint: 'First prompt.' },
  { value: 'terminal', label: 'Terminal only', hint: 'A shell.' },
]

function Harness(): React.JSX.Element {
  const [runAs, setRunAs] = useState<RunAs>('agent')
  return <RunAsChoices options={options} runAs={runAs} onPick={setRunAs} />
}

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('RunAsChoices keyboard', () => {
  it('chooses Run as with the arrow keys alone', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('radio', { name: options[0].label }).matches(':focus')).toBe(true)

    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByRole('radio', { name: 'Terminal only', checked: true }).matches(':focus')
    ).toBe(true)

    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: options[0].label, checked: true })).toBeTruthy()
  })
})
