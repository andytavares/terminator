import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

import { useFieldChangeCounter } from '../../../../src/renderer/usage/use-field-change-counter'

function Section(): React.JSX.Element {
  const countChange = useFieldChangeCounter('core.settings.change.global')
  return (
    <div onChange={countChange}>
      <input aria-label="Font size" />
      <input aria-label="Scrollback" />
    </div>
  )
}

describe('useFieldChangeCounter', () => {
  beforeEach(() => recordUse.mockClear())

  it('counts a field once however many keystrokes change it', async () => {
    const user = userEvent.setup()
    render(<Section />)
    await user.type(screen.getByLabelText('Font size'), '144')
    expect(recordUse.mock.calls).toEqual([['core.settings.change.global']])
  })

  it('counts each field that changes', async () => {
    const user = userEvent.setup()
    render(<Section />)
    await user.type(screen.getByLabelText('Font size'), '14')
    await user.type(screen.getByLabelText('Scrollback'), '5000')
    expect(recordUse).toHaveBeenCalledTimes(2)
  })

  it('counts the same field again the next time the section is shown', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Section />)
    await user.type(screen.getByLabelText('Font size'), '14')
    unmount()
    render(<Section />)
    await user.type(screen.getByLabelText('Font size'), '15')
    expect(recordUse).toHaveBeenCalledTimes(2)
  })
})
