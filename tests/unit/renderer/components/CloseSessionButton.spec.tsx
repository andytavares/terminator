import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CloseSessionButton } from '../../../../src/renderer/components/session/CloseSessionButton'
import { fact } from '../sidebar/fixtures/facts'

describe('CloseSessionButton', () => {
  it('ends the session it names', () => {
    const onClose = vi.fn()
    const facts = fact({ name: 'claude' })
    render(<CloseSessionButton facts={facts} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close claude' }))
    expect(onClose).toHaveBeenCalledWith(facts)
  })

  it('draws nothing for a session that has already closed', () => {
    const { container } = render(
      <CloseSessionButton facts={fact({ isClosed: true })} onClose={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('does not open the row or tile it sits on', () => {
    const behind = vi.fn()
    render(
      <div onClick={behind} onKeyDown={behind}>
        <CloseSessionButton facts={fact({ name: 'zsh' })} onClose={vi.fn()} />
      </div>
    )
    const button = screen.getByRole('button', { name: 'Close zsh' })
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(behind).not.toHaveBeenCalled()
  })
})
