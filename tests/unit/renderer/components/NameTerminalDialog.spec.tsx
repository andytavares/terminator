import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

  it('calls onConfirm with the typed name on Open click', () => {
    renderDialog()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'My API server' } })
    fireEvent.click(screen.getByText('Open'))
    expect(onConfirm).toHaveBeenCalledWith('My API server')
  })

  it('calls onConfirm with empty string when no name is entered', () => {
    renderDialog()
    fireEvent.click(screen.getByText('Open'))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('calls onCancel when Cancel button is clicked', () => {
    renderDialog()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('NameTerminalDialog — dismiss', () => {
  it('calls onCancel when Escape is pressed', () => {
    renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
