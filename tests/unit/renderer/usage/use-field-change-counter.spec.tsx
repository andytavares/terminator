import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

  it('counts a field once however many keystrokes change it', () => {
    render(<Section />)
    const field = screen.getByLabelText('Font size')
    for (const value of ['1', '14', '144']) fireEvent.change(field, { target: { value } })
    expect(recordUse.mock.calls).toEqual([['core.settings.change.global']])
  })

  it('counts each field that changes', () => {
    render(<Section />)
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('Scrollback'), { target: { value: '5000' } })
    expect(recordUse).toHaveBeenCalledTimes(2)
  })

  it('counts the same field again the next time the section is shown', () => {
    const { unmount } = render(<Section />)
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '14' } })
    unmount()
    render(<Section />)
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '15' } })
    expect(recordUse).toHaveBeenCalledTimes(2)
  })
})
