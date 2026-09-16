import { describe, it, expect } from 'vitest'
import { planResume } from '../../../../src/renderer/sidebar/resume'
import { fact } from './fixtures/facts'
import type { AgentConversation } from '../../../../src/shared/types/index'

const conversation: AgentConversation = {
  provider: 'claude',
  sessionId: 'b610a882-41f3-4833-a6a3-dc3a33aea060',
  transcriptPath: '/t/b610a882.jsonl',
  cwd: '/code/northwind-api',
  capturedAt: '2026-09-15T18:00:00.000Z',
}

const exited = (patch = {}) =>
  fact({ state: 'exited', agent: conversation, resumable: true, ...patch })

// The command is reached through planResume, the only way the application
// asks for one.
describe('the command a resume runs', () => {
  it('asks Claude Code to carry on the conversation', () => {
    expect(planResume(exited())?.command).toBe(
      'claude --resume b610a882-41f3-4833-a6a3-dc3a33aea060'
    )
  })

  it.each([['id with spaces'], ['id;rm -rf /'], ['$(whoami)'], ['a`b`'], ['--flag']])(
    'refuses an id that is not one: %s',
    (sessionId) => {
      expect(planResume(exited({ agent: { ...conversation, sessionId } }))).toBeNull()
    }
  )
})

describe('planResume', () => {
  it('plans a resume for an exited session whose conversation is still there', () => {
    expect(planResume(exited())).toEqual({
      fromSessionId: 's1',
      projectId: 'p1',
      cwd: '/code/northwind-api',
      command: 'claude --resume b610a882-41f3-4833-a6a3-dc3a33aea060',
      conversationId: conversation.sessionId,
    })
  })

  it('plans one for a closed session too', () => {
    expect(
      planResume(exited({ isClosed: true, closedAt: '2026-09-15T19:00:00.000Z' }))
    ).not.toBeNull()
  })

  it.each([
    ['running', { state: 'working' as const }],
    ['waiting on you', { state: 'awaiting-input' as const }],
    ['idle', { state: 'idle' as const }],
  ])('has no plan for a session that is %s', (_name, patch) => {
    expect(planResume(exited(patch))).toBeNull()
  })

  it('has no plan without a conversation', () => {
    expect(planResume(exited({ agent: null, resumable: false }))).toBeNull()
  })

  it('has no plan when the conversation can no longer be resumed', () => {
    expect(planResume(exited({ resumable: false }))).toBeNull()
  })

  it('takes the branch from the snapshot, which a closed session still has', () => {
    const closed = exited({
      isClosed: true,
      projectId: null,
      snapshot: { ...fact().snapshot, projectId: 'p9' },
    })
    expect(planResume(closed)?.projectId).toBe('p9')
  })

  it('has no plan for a session whose branch is gone', () => {
    expect(planResume(exited({ snapshot: { ...fact().snapshot, projectId: '' } }))).toBeNull()
  })
})
