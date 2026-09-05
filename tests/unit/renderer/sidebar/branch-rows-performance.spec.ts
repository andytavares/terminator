import { describe, it, expect } from 'vitest'
import { buildBranchRows } from '../../../../src/renderer/sidebar/branch-rows'
import { BUILT_IN_VIEWS } from '../../../../src/renderer/sidebar/views'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

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

describe('rebuilding the branch list stays well inside budget', () => {
  it.each(BUILT_IN_VIEWS.map((v) => [v.name, v] as const))(
    'builds the %s view quickly',
    (_name, view) => {
      const started = performance.now()
      for (let i = 0; i < 20; i++) {
        buildBranchRows(sessions, projects, workspaces, view, NOW, STALE_AFTER)
      }
      expect(performance.now() - started).toBeLessThan(100)
    }
  )

  // The sidebar must not get slower as terminals pile up on one branch: the
  // cost is one pass over the sessions plus one over the branches, not a scan
  // of every session for every branch.
  it('scales with sessions plus branches, not their product', () => {
    const many: TerminalSession[] = Array.from({ length: 2000 }, (_, i) => ({
      ...sessions[i % sessions.length],
      id: `big-${i}`,
    }))
    const started = performance.now()
    buildBranchRows(many, projects, workspaces, BUILT_IN_VIEWS[0], NOW, STALE_AFTER)
    expect(performance.now() - started).toBeLessThan(100)
  })
})
