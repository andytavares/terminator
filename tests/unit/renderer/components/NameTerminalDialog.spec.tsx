import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NameTerminalDialog } from '../../../../src/renderer/components/NameTerminalDialog'

const defaultName = 'Terminal 1'

let onConfirm: Mock<(name: string) => void>

let onCancel: Mock<() => void>

function renderDialog() {
  return render(
    <NameTerminalDialog defaultName={defaultName} onConfirm={onConfirm} onCancel={onCancel} />
  )
}

beforeEach(() => {
  onConfirm = vi.fn()
  onCancel = vi.fn()
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('NameTerminalDialog', () => {
  it('titles the dialog and shows the default name as the placeholder', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Name this terminal' })
    const input = within(dialog).getByRole('textbox') as HTMLInputElement
    expect(input.placeholder).toBe(defaultName)
  })

  it('calls onConfirm with the typed name on Open click', async () => {
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'My API server')
    await user.click(screen.getByText('Open'))
    expect(onConfirm).toHaveBeenCalledWith('My API server')
  })

  it('calls onConfirm with empty string when no name is entered', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByText('Open'))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('calls onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('NameTerminalDialog — dismiss', () => {
  it('calls onCancel when Escape is pressed', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
