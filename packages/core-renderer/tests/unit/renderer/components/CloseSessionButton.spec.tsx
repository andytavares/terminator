import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CloseSessionButton } from '../../../../src/components/session/CloseSessionButton'
import { fact } from '../sidebar/fixtures/facts'

describe('CloseSessionButton', () => {
  it('ends the session it names', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const facts = fact({ name: 'claude' })
    render(<CloseSessionButton facts={facts} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Close claude' }))
    expect(onClose).toHaveBeenCalledWith(facts)
  })

  it('draws nothing for a closed session where nothing can be removed', () => {
    const { container } = render(
      <CloseSessionButton facts={fact({ isClosed: true })} onClose={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  // The same control, answering the same question: take this off my list.
  it('removes a closed session from the list rather than ending it', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    const onClose = vi.fn()
    const facts = fact({ isClosed: true, name: 'pnpm build' })
    render(<CloseSessionButton facts={facts} onClose={onClose} onForget={onForget} />)
    await user.click(screen.getByRole('button', { name: 'Remove pnpm build from the list' }))
    expect(onForget).toHaveBeenCalledWith(facts)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('CloseSessionButton — still ends a live session when removing is also possible', () => {
  it('still ends a live session when removing is also possible', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    const onClose = vi.fn()
    render(
      <CloseSessionButton facts={fact({ name: 'zsh' })} onClose={onClose} onForget={onForget} />
    )
    await user.click(screen.getByRole('button', { name: 'Close zsh' }))
    expect(onClose).toHaveBeenCalled()
    expect(onForget).not.toHaveBeenCalled()
  })

  it('does not open the row or tile it sits on', async () => {
    const user = userEvent.setup()
    const behind = vi.fn()
    render(
      <div onClick={behind} onKeyDown={behind}>
        <CloseSessionButton facts={fact({ name: 'zsh' })} onClose={vi.fn()} />
      </div>
    )
    const button = screen.getByRole('button', { name: 'Close zsh' })
    await user.click(button)
    expect(button.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(behind).not.toHaveBeenCalled()
  })
})
