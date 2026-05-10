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
})
