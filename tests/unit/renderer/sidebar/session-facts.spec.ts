import { describe, it, expect } from 'vitest'
import { buildSessionFacts } from '../../../../src/renderer/sidebar/session-facts'
import {
  SCRATCH_PROJECT_ID,
  type IssueLink,
  type Project,
  type SessionRecord,
  type TerminalSession,
  type Workspace,
} from '../../../../src/shared/types/index'

const workspace: Workspace = {
  id: 'w1',
  name: 'Northwind',
  folderPath: '/code/nw',
  color: '#3fa39a',
  tags: ['client', 'api'],
  createdAt: '',
  updatedAt: '',
}

const project: Project = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'northwind-api',
  gitBranch: 'nw-88-rate-limits',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

const session: TerminalSession = {
  id: 's1',
  projectId: 'p1',
  tabTitle: 'claude',
  status: 'active',
  type: 'human',
  scrollbackLimit: 1000,
  createdAt: '2026-09-15T10:00:00.000Z',
  lastActivityAt: 500,
  agentState: 'working',
  shell: '/bin/zsh',
}

function record(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    workspaceName: 'Northwind',
    projectName: 'northwind-api',
    branch: 'main',
    tabTitle: 'zsh',
    shell: '/bin/zsh',
    description: 'Reproducing the staging 429s',
    link: null,
    startedAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:30:00.000Z',
    ...patch,
  }
}

const empty = {
  sessions: [] as TerminalSession[],
  records: [] as SessionRecord[],
  projects: [project],
  workspaces: [workspace],
  projectLinks: new Map<string, IssueLink | null>(),
}

describe('buildSessionFacts', () => {
  it('describes an open session from where it lives', () => {
    const [facts] = buildSessionFacts({
      ...empty,
      sessions: [{ ...session, latestLine: '14 passed, 2 failed' }],
    })
    expect(facts).toMatchObject({
      sessionId: 's1',
      name: 'claude',
      state: 'working',
      isClosed: false,
      projectId: 'p1',
      workspaceName: 'Northwind',
      workspaceColor: '#3fa39a',
      projectName: 'northwind-api',
      branch: 'nw-88-rate-limits',
      shell: '/bin/zsh',
      tags: ['client', 'api'],
      workItem: null,
      description: null,
      lastActivityAt: 500,
      closedAt: null,
      latestLine: '14 passed, 2 failed',
    })
  })

  it('lists every open session exactly once', () => {
    const facts = buildSessionFacts({
      ...empty,
      sessions: [session, { ...session, id: 's2' }],
    })
    expect(facts.map((f) => f.sessionId)).toEqual(['s1', 's2'])
  })

  it("adds the agent tag to an agent session, after the workspace's own tags", () => {
    const [facts] = buildSessionFacts({ ...empty, sessions: [{ ...session, type: 'agent' }] })
    expect(facts.tags).toEqual(['client', 'api', 'agent'])
  })

  it('carries the description and own link from the record', () => {
    const [facts] = buildSessionFacts({
      ...empty,
      sessions: [session],
      records: [record({ link: { tracker: 'linear', key: 'NW-88' } })],
    })
    expect(facts.description).toBe('Reproducing the staging 429s')
    expect(facts.workItem).toEqual({ source: 'session', ref: { tracker: 'linear', key: 'NW-88' } })
  })

  it("uses the project's link when the session has none", () => {
    const link: IssueLink = {
      projectId: 'p1',
      tracker: 'linear',
      key: 'NW-91',
      injectContext: true,
      linkedAt: '',
    }
    const [facts] = buildSessionFacts({
      ...empty,
      sessions: [session],
      projectLinks: new Map([['p1', link]]),
    })
    expect(facts.workItem).toEqual({ source: 'project', ref: { tracker: 'linear', key: 'NW-91' } })
  })

  it('reads a session whose process exited as exited, but not closed', () => {
    const [facts] = buildSessionFacts({
      ...empty,
      sessions: [{ ...session, status: 'closed', agentState: 'exited' }],
    })
    expect(facts.state).toBe('exited')
    expect(facts.isClosed).toBe(false)
  })

  it('includes a closed record, read from its snapshot', () => {
    const [facts] = buildSessionFacts({
      ...empty,
      records: [record({ closedAt: '2026-09-15T11:00:00.000Z' })],
    })
    expect(facts).toMatchObject({
      sessionId: 's1',
      name: 'zsh',
      state: 'exited',
      isClosed: true,
      workspaceName: 'Northwind',
      workspaceColor: null,
      projectName: 'northwind-api',
      branch: 'main',
      closedAt: '2026-09-15T11:00:00.000Z',
      lastActivityAt: Date.parse('2026-09-15T11:00:00.000Z'),
      latestLine: '',
      tags: [],
    })
  })

  it('does not list a record twice when its session is still open', () => {
    const facts = buildSessionFacts({
      ...empty,
      sessions: [session],
      records: [record({ closedAt: '2026-09-15T11:00:00.000Z' })],
    })
    expect(facts).toHaveLength(1)
    expect(facts[0].isClosed).toBe(false)
  })

  it('does not list an open record without its session', () => {
    expect(buildSessionFacts({ ...empty, records: [record()] })).toEqual([])
  })

  it('keeps a session whose project has gone, with no location', () => {
    const [facts] = buildSessionFacts({ ...empty, sessions: [{ ...session, projectId: 'gone' }] })
    expect(facts).toMatchObject({
      workspaceName: null,
      projectName: null,
      branch: null,
      workspaceColor: null,
      tags: [],
    })
  })

  it('gives a scratch terminal no location and no colour', () => {
    const [facts] = buildSessionFacts({
      ...empty,
      sessions: [{ ...session, projectId: SCRATCH_PROJECT_ID }],
    })
    expect(facts.projectId).toBeNull()
    expect(facts.workspaceColor).toBeNull()
  })

  it('leaves the shell out when it is not known', () => {
    const [facts] = buildSessionFacts({ ...empty, sessions: [{ ...session, shell: undefined }] })
    expect(facts.shell).toBeNull()
  })

  it('builds the snapshot a write needs', () => {
    const [facts] = buildSessionFacts({ ...empty, sessions: [session] })
    expect(facts.snapshot).toEqual({
      sessionId: 's1',
      projectId: 'p1',
      workspaceName: 'Northwind',
      projectName: 'northwind-api',
      branch: 'nw-88-rate-limits',
      tabTitle: 'claude',
      shell: '/bin/zsh',
      startedAt: '2026-09-15T10:00:00.000Z',
    })
  })

  it('carries a choice prompt from the session', () => {
    const prompt = { question: 'Proceed?', options: [{ number: 1, label: 'Yes' }] }
    const [facts] = buildSessionFacts({
      ...empty,
      sessions: [{ ...session, choicePrompt: prompt }],
    })
    expect(facts.choicePrompt).toEqual(prompt)
  })
})
