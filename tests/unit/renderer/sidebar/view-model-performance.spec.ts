import { describe, it, expect } from 'vitest'
import { buildGroups } from '../../../../src/renderer/sidebar/view-model'
import { BUILT_IN_VIEWS } from '../../../../src/renderer/sidebar/views'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

const NOW = 1_000_000_000

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
  note: i % 5 === 0 ? `note ${i}` : undefined,
}))

describe('SC-008: regrouping 100 sessions stays under 100 ms', () => {
  it.each(BUILT_IN_VIEWS.map((v) => [v.name, v] as const))(
    'builds the %s view well inside budget',
    (_name, view) => {
      // Warm the JIT so the measurement is of steady state, not first-call cost.
      for (let i = 0; i < 20; i++) {
        buildGroups(sessions, projects, workspaces, view, NOW, 7_200_000)
      }
      const started = performance.now()
      for (let i = 0; i < 20; i++) {
        buildGroups(sessions, projects, workspaces, view, NOW, 7_200_000)
      }
      const perBuild = (performance.now() - started) / 20
      expect(perBuild).toBeLessThan(100)
    }
  )

  it.each(['project', 'workspace', 'status', 'branch', 'none'] as const)(
    'regroups by %s well inside budget',
    (groupBy) => {
      const view = { ...BUILT_IN_VIEWS[0], groupBy }
      for (let i = 0; i < 20; i++) {
        buildGroups(sessions, projects, workspaces, view, NOW, 7_200_000)
      }
      const started = performance.now()
      for (let i = 0; i < 20; i++) {
        buildGroups(sessions, projects, workspaces, view, NOW, 7_200_000)
      }
      expect((performance.now() - started) / 20).toBeLessThan(100)
    }
  )

  it('still groups every one of the 100 sessions', () => {
    const result = buildGroups(sessions, projects, workspaces, BUILT_IN_VIEWS[0], NOW, 7_200_000)
    expect(result.groups.reduce((n, g) => n + g.count, 0)).toBe(100)
  })
})
