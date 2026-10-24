import type { SessionFacts } from '../../../../../src/renderer/sidebar/session-facts'

/** What the screen and the hooks say: nothing asked, nothing guessed, nothing running. */
const SIGNALS = {
  latestLine: '',
  choicePrompt: null,
  askMessage: null,
  askInferred: false,
  askSignal: null,
  runningFrom: null,
} as const

/** A session's facts with every field present, for the pure layer's specs to vary one at a time. */
export function fact(patch: Partial<SessionFacts> = {}): SessionFacts {
  const sessionId = patch.sessionId ?? 's1'
  return {
    sessionId,
    name: 'zsh',
    state: 'idle',
    isClosed: false,
    projectId: 'p1',
    workspaceName: 'Personal',
    workspaceColor: '#5c6bc0',
    projectName: 'terminator',
    branch: 'main',
    shell: '/bin/zsh',
    tags: [],
    workItem: null,
    description: null,
    lastActivityAt: 0,
    lastAttendedAt: null,
    startedAt: '2026-09-15T10:00:00.000Z',
    closedAt: null,
    ...SIGNALS,
    agent: null,
    resumable: false,
    snapshot: snapshotOf(sessionId),
    ...patch,
  }
}

function snapshotOf(sessionId: string): SessionFacts['snapshot'] {
  return {
    sessionId,
    projectId: 'p1',
    workspaceName: 'Personal',
    projectName: 'terminator',
    branch: 'main',
    tabTitle: 'zsh',
    shell: '/bin/zsh',
    startedAt: '2026-09-15T10:00:00.000Z',
  }
}
