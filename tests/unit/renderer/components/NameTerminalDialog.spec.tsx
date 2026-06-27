import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NameTerminalDialog } from '../../../../src/renderer/components/NameTerminalDialog'

vi.mock('../../../../src/renderer/components/sidebar/Dialog.css', () => ({}))

describe('NameTerminalDialog', () => {
  const defaultName = 'Terminal 1'
  let onConfirm: ReturnType<typeof vi.fn>
  let onCancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onConfirm = vi.fn()
    onCancel = vi.fn()
  })

  function renderDialog() {
    return render(
      <NameTerminalDialog defaultName={defaultName} onConfirm={onConfirm} onCancel={onCancel} />
    )
  }

  it('renders the dialog title', () => {
    renderDialog()
    expect(screen.getByText('Name this terminal')).toBeTruthy()
  })

  it('shows placeholder with the default name', () => {
    renderDialog()
    const input = screen.getByRole('textbox') as HTMLInputElement
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

  it('calls onCancel when overlay is clicked', () => {
    renderDialog()
    fireEvent.click(document.querySelector('.dialog-overlay')!)
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not call onCancel when dialog body is clicked', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when Escape is pressed', () => {
    renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not call onCancel when a non-Escape key is pressed', () => {
    renderDialog()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('submits on Enter key via form submit', () => {
    renderDialog()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Build runner' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(onConfirm).toHaveBeenCalledWith('Build runner')
  })
})
