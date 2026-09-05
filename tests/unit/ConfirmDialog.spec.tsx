import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ConfirmDialog } from '../../src/renderer/components/ConfirmDialog'

describe('ConfirmDialog', () => {
  const baseProps = {
    title: 'Remove workspace "My Repo"?',
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title', () => {
    render(<ConfirmDialog {...baseProps} />)
    expect(screen.getByText('Remove workspace "My Repo"?')).toBeTruthy()
  })

  it('renders description when provided', () => {
    render(<ConfirmDialog {...baseProps} description="This will delete all 4 projects." />)
    expect(screen.getByText('This will delete all 4 projects.')).toBeTruthy()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmDialog {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when cancel button is clicked', () => {
    render(<ConfirmDialog {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(baseProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape key is pressed', () => {
    render(<ConfirmDialog {...baseProps} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(baseProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('uses custom confirmLabel when provided', () => {
    render(<ConfirmDialog {...baseProps} confirmLabel="Remove" />)
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy()
  })

  it('applies danger class to confirm button when danger prop is true', () => {
    render(<ConfirmDialog {...baseProps} danger />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn.className).toContain('danger')
  })

  it('cancel button receives initial focus', () => {
    render(<ConfirmDialog {...baseProps} />)
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    expect(document.activeElement).toBe(cancelBtn)
  })

  // These three used to assert the literal id `confirm-dialog-title` and the
  // class `.dialog__description`. The dialog now comes from
  // @terminator/extension-ui and labels itself through `useId`, which is the
  // better behaviour: a hardcoded id collides the moment two dialogs are open
  // at once, and this component is now shared with every extension. The
  // assertions are rewritten to check what they were actually protecting.
  it('labels the dialog with its own title element', () => {
    const { container } = render(<ConfirmDialog {...baseProps} />)
    const dialog = container.querySelector('[role="dialog"]')
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const title = document.getElementById(labelledBy!)
    expect(title?.textContent).toBe(baseProps.title)
  })

  it('gives two dialogs distinct label ids rather than a shared literal', () => {
    const { container } = render(
      <>
        <ConfirmDialog {...baseProps} />
        <ConfirmDialog {...baseProps} title="Second" />
      </>
    )
    const ids = Array.from(container.querySelectorAll('[role="dialog"]')).map((d) =>
      d.getAttribute('aria-labelledby')
    )
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('styles the description by class rather than inline', () => {
    const { container } = render(
      <ConfirmDialog {...baseProps} description="This will delete all 4 projects." />
    )
    const desc = container.querySelector('.tmui-dialog__description')
    expect(desc).toBeTruthy()
    expect(desc?.getAttribute('style')).toBeFalsy()
  })
})
