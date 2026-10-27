import { describe, it, expect, vi } from 'vitest'
import {
  conversationOfTab,
  recordAgentTab,
  transcriptPathFor,
} from '../../../../src/main/agents/acp/record-agent-tab'

const setAgent = vi.hoisted(() => vi.fn(async () => null))
vi.mock('../../../../src/main/sessions/session-record-store', () => ({ setAgent }))
vi.mock('../../../../src/main/sessions/session-snapshot', () => ({
  projectPlace: () => ({ workspaceName: 'Northwind', projectName: 'api', branch: 'main' }),
}))

describe('transcriptPathFor', () => {
  it('names the file Claude Code keeps for a session, with / and . replaced by -', () => {
    expect(transcriptPathFor('/code/my.repo', 'abc', '/home/ann')).toBe(
      '/home/ann/.claude/projects/-code-my-repo/abc.jsonl'
    )
  })
})

describe('conversationOfTab', () => {
  const tab = { sessionId: 's1', cwd: '/code', tab: { projectId: 'p1', title: 'Fix' } }

  it('is an acp conversation with the derived transcript for claude', () => {
    const conversation = conversationOfTab({ ...tab, agentId: 'claude' }, '2026-10-26T00:00:00Z')
    expect(conversation).toEqual({
      agentId: 'claude',
      transport: 'acp',
      sessionId: 's1',
      transcriptPath: expect.stringMatching(/\.claude\/projects\/-code\/s1\.jsonl$/),
      cwd: '/code',
      capturedAt: '2026-10-26T00:00:00Z',
    })
  })

  it('has no transcript for another agent', () => {
    expect(conversationOfTab({ ...tab, agentId: 'opencode' }, 'now').transcriptPath).toBeNull()
  })
})

describe('recordAgentTab', () => {
  it('stores the conversation against a snapshot of the tab', () => {
    recordAgentTab(
      {
        sessionId: 's1',
        agentId: 'opencode',
        cwd: '/code',
        tab: { projectId: 'p1', title: 'Fix' },
      },
      () => '2026-10-26T00:00:00.000Z'
    )
    expect(setAgent).toHaveBeenCalledWith(
      {
        sessionId: 's1',
        projectId: 'p1',
        workspaceName: 'Northwind',
        projectName: 'api',
        branch: 'main',
        tabTitle: 'Fix',
        shell: null,
        startedAt: '2026-10-26T00:00:00.000Z',
      },
      expect.objectContaining({ agentId: 'opencode', transport: 'acp', transcriptPath: null })
    )
  })
})
