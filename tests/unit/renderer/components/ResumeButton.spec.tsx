import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeButton } from '../../../../src/renderer/components/session/ResumeButton'
import { fact } from '../sidebar/fixtures/facts'
import type { AgentConversation } from '../../../../src/shared/types/index'

const conversation: AgentConversation = {
  agentId: 'claude',
  transport: 'tui',
  sessionId: 'b610a882',
  transcriptPath: '/t/b610a882.jsonl',
  cwd: '/code/repo',
  capturedAt: '2026-09-15T18:00:00.000Z',
}

const exited = (patch = {}) =>
  fact({ name: 'claude', state: 'exited', agent: conversation, resumable: true, ...patch })

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('ResumeButton', () => {
  it('offers to resume a stopped conversation, naming the session', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    render(<ResumeButton facts={exited()} onResume={onResume} />)
    await user.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(onResume).toHaveBeenCalledWith(exited())
  })

  it('says so when the conversation can no longer be resumed', () => {
    render(<ResumeButton facts={exited({ resumable: false })} onResume={vi.fn()} />)
    expect(screen.getByText('Conversation no longer available')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each([
    ['a session that never had a conversation', { agent: null, resumable: false }],
    ['an agent that is still running', { state: 'working' }],
  ])('draws nothing for %s', (_case, patch) => {
    const { container } = render(<ResumeButton facts={exited(patch)} onResume={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('ResumeButton — does not open the row or tile it sits on', () => {
  it('does not open the row or tile it sits on', async () => {
    const user = userEvent.setup()
    const behind = vi.fn()
    render(
      <div onClick={behind} onKeyDown={behind}>
        <ResumeButton facts={exited()} onResume={vi.fn()} />
      </div>
    )
    await user.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(screen.getByRole('button', { name: 'Resume claude' }).matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(behind).not.toHaveBeenCalled()
  })
})
