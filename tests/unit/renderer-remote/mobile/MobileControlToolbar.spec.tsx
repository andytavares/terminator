import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

describe('MobileControlToolbar', () => {
  it.each([
    ['Ctrl+C', '\x03'],
    ['Ctrl+D', '\x04'],
    ['Tab', '\t'],
    ['Esc', '\x1b'],
    ['↑', '\x1b[A'],
    ['↓', '\x1b[B'],
  ])('sends the %s key sequence when its key is pressed', async (label, sequence) => {
    const user = userEvent.setup()
    const onKey = vi.fn()
    const { MobileControlToolbar } =
      await import('../../../../src/renderer-remote/components/MobileControlToolbar')
    render(<MobileControlToolbar onKey={onKey} />)
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByLabelText(label) })
    expect(onKey).toHaveBeenCalledWith(sequence)
  })
})
