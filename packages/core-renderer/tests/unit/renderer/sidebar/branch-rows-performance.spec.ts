import { describe, it, expect } from 'vitest'
import { buildBranchRows } from '../../../../src/sidebar/branch-rows'
import { BUILT_IN_VIEWS } from '../../../../src/sidebar/views'
import type {
  Project,
  TerminalSession,
  Workspace,
} from '../../../../../core-shared/src/types/index'

const NOW = 1_000_000_000
const STALE_AFTER = 2 * 60 * 60 * 1000

const workspaces: Workspace[] = Array.from({ length: 4 }, (_, i) => ({
  id: `w${i}`,
  name: `WS ${i}`,
  folderPath: `/w${i}`,
  color: '#111',
  tags: [],
  createdAt: '',
  updatedAt: '',
}))

const projects: Project[] = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`,
  workspaceId: `w${i % 4}`,
  name: `Project ${i}`,
  gitBranch: `branch-${i % 5}`,
  isWorktree: i % 3 === 0,
  createdAt: '',
  updatedAt: '',
}))

const states = ['working', 'awaiting-input', 'idle', 'exited'] as const
const sessions: TerminalSession[] = Array.from({ length: 100 }, (_, i) => ({
  id: `s${i}`,
  projectId: `p${i % 12}`,
  tabTitle: `session-${i}`,
  status: 'active',
  type: 'agent',
  scrollbackLimit: 10000,
  createdAt: '2026-08-21T00:00:00.000Z',
  lastActivityAt: NOW - i * 60_000,
  agentState: states[i % 4],
}))

/** Builds `view` over `sessionCount` sessions spread across `projectCount` branches, and returns
 * how many session fields it read: an operation count, which a loaded machine cannot change. */
function sessionReadsToBuild(
  view: (typeof BUILT_IN_VIEWS)[number],
  projectCount: number,
  sessionCount: number
): number {
  let reads = 0
  const branches: Project[] = Array.from({ length: projectCount }, (_, i) => ({
    ...projects[i % projects.length],
    id: `p${i}`,
  }))
  const counted: TerminalSession[] = Array.from({ length: sessionCount }, (_, i) => {
    const session = {
      ...sessions[i % sessions.length],
      id: `big-${i}`,
      projectId: `p${i % projectCount}`,
    }
    return new Proxy(session, {
      get(target, key, receiver) {
        reads++
        return Reflect.get(target, key, receiver)
      },
    })
  })
  buildBranchRows({ sessions: counted, projects: branches, workspaces }, view, {
    now: NOW,
    staleAfterMs: STALE_AFTER,
  })
  return reads
}

// The sidebar must not get slower as terminals pile up on one branch: the cost is one pass over
// the sessions plus one over the branches, not a scan of every session for every branch. With
// four times the branches over the same sessions, a scan per branch reads four times as much.
describe('rebuilding the branch list', () => {
  it.each(BUILT_IN_VIEWS.map((v) => [v.name, v] as const))(
    'builds the %s view with work that grows with sessions plus branches, not their product',
    (_name, view) => {
      const fewBranches = sessionReadsToBuild(view, 12, 2000)
      const manyBranches = sessionReadsToBuild(view, 48, 2000)
      expect(manyBranches).toBeLessThan(fewBranches * 2)
    }
  )
})
