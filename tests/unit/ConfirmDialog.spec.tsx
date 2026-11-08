import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { ConfirmDialog } from '../../src/renderer/components/ConfirmDialog'

const baseProps = {
  title: 'Remove workspace "My Repo"?',
  onConfirm: vi.fn(),
  onClose: vi.fn(),
}

describe('ConfirmDialog — applies danger class to confirm button when danger prop is true', () => {
  it('applies danger class to confirm button when danger prop is true', () => {
    render(<ConfirmDialog {...baseProps} danger />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn.className).toContain('danger')
  })
})

describe('ConfirmDialog — gives two dialogs distinct label ids rather than a shared literal', () => {
  it('gives two dialogs distinct label ids rather than a shared literal', () => {
    const { container } = render(
      <>
        <ConfirmDialog {...baseProps} />
        <ConfirmDialog {...baseProps} title="Second" />
      </>
    )
    const ids = Array.from(container.querySelectorAll('dialog')).map((d) =>
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
