import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasonButton } from '../../src/components/ReasonButton.js'

// Every Forge control that can be unavailable uses this. With a reason it stays
// focusable (aria-disabled, not disabled), links the reason via aria-describedby,
// and shows it inline on click instead of firing the action.

describe('ReasonButton', () => {
  it('without a reason renders a plain, enabled button and fires onClick', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<ReasonButton onClick={onClick}>Redraft</ReasonButton>)
    const button = screen.getByRole('button', { name: 'Redraft' }) as HTMLButtonElement
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    expect(button.disabled).toBe(false)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('with a reason marks aria-disabled, describes it, and stays focusable', () => {
    render(
      <ReasonButton reason="The red team is reviewing the plan." onClick={vi.fn()}>
        Redraft
      </ReasonButton>
    )
    const button = screen.getByRole('button', { name: 'Redraft' }) as HTMLButtonElement
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false)
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const tip = screen.getByRole('tooltip')
    expect(tip.getAttribute('id')).toBe(describedBy)
    expect(tip.textContent).toBe('The red team is reviewing the plan.')
  })

  it('swallows the click, never calls onClick, and does not submit a form', async () => {
    const onClick = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const user = userEvent.setup()
    render(
      <form onSubmit={onSubmit}>
        <ReasonButton type="submit" reason="Not ready yet." onClick={onClick}>
          Hand off
        </ReasonButton>
      </form>
    )
    await user.click(screen.getByRole('button', { name: 'Hand off' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the reason inline after a click, and clears it when the reason goes away', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ReasonButton reason="The red team is reviewing the plan." onClick={vi.fn()}>
        Redraft
      </ReasonButton>
    )
    expect(document.querySelector('.fdry-inline-why')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Redraft' }))
    expect(
      screen
        .getAllByText('The red team is reviewing the plan.')
        .some((el) => el.className === 'fdry-inline-why')
    ).toBe(true)

    rerender(
      <ReasonButton reason={null} onClick={vi.fn()}>
        Redraft
      </ReasonButton>
    )
    expect(screen.queryByText('The red team is reviewing the plan.')).toBeNull()
  })

  it('clears the inline reason when the reason text changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ReasonButton reason="First reason." onClick={vi.fn()}>
        Redraft
      </ReasonButton>
    )
    await user.click(screen.getByRole('button', { name: 'Redraft' }))
    expect(
      screen.getAllByText('First reason.').some((el) => el.className === 'fdry-inline-why')
    ).toBe(true)

    rerender(
      <ReasonButton reason="Second reason." onClick={vi.fn()}>
        Redraft
      </ReasonButton>
    )
    expect(document.querySelector('.fdry-inline-why')).toBeNull()
  })

  it('is keyboard-focusable when it has a reason', () => {
    render(
      <ReasonButton reason="Not ready yet." onClick={vi.fn()}>
        Redraft
      </ReasonButton>
    )
    const button = screen.getByRole('button', { name: 'Redraft' })
    button.focus()
    expect(document.activeElement).toBe(button)
  })
})
