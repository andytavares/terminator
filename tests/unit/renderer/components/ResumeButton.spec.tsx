import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResumeButton } from '../../../../src/renderer/components/session/ResumeButton'
import { fact } from '../sidebar/fixtures/facts'
import type { AgentConversation } from '../../../../src/shared/types/index'

const conversation: AgentConversation = {
  provider: 'claude',
  sessionId: 'b610a882',
  transcriptPath: '/t/b610a882.jsonl',
  cwd: '/code/repo',
  capturedAt: '2026-09-15T18:00:00.000Z',
}

const exited = (patch = {}) =>
  fact({ name: 'claude', state: 'exited', agent: conversation, resumable: true, ...patch })

describe('ResumeButton', () => {
  it('offers to resume a stopped conversation, naming the session', () => {
    const onResume = vi.fn()
    render(<ResumeButton facts={exited()} onResume={onResume} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(onResume).toHaveBeenCalledWith(exited())
  })

  it('says so when the conversation can no longer be resumed', () => {
    render(<ResumeButton facts={exited({ resumable: false })} onResume={vi.fn()} />)
    expect(screen.getByText('Conversation no longer available')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws nothing for a session that never had a conversation', () => {
    const { container } = render(
      <ResumeButton facts={exited({ agent: null, resumable: false })} onResume={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('draws nothing while the agent is still running', () => {
    const { container } = render(
      <ResumeButton facts={exited({ state: 'working' })} onResume={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('does not open the row or tile it sits on', () => {
    const behind = vi.fn()
    render(
      <div onClick={behind} onKeyDown={behind}>
        <ResumeButton facts={exited()} onResume={vi.fn()} />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resume claude' }), { key: 'Enter' })
    expect(behind).not.toHaveBeenCalled()
  })
})
