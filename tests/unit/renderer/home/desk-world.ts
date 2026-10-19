import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { fact } from '../sidebar/fixtures/facts'
import { facet } from './fixtures'
import type { MergedHomeFeed } from '../../../../src/shared/schemas/home-feed.schema'
import type { Issue, Project, Workspace } from '../../../../src/shared/types/index'

export const NOW = Date.now()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const REPO_ROOT = '/repos/terminator'

const workspace: Workspace = {
  id: 'ws1',
  name: 'terminator',
  folderPath: REPO_ROOT,
  color: '#4ade80',
  tags: [],
  createdAt: '',
  updatedAt: '',
}

const project = (id: string, branch: string): Project => ({
  id,
  workspaceId: 'ws1',
  name: branch,
  gitBranch: branch,
  isWorktree: true,
  createdAt: '',
  updatedAt: '',
})

export const ticket = (key: string, source: 'project' | 'session' = 'project') =>
  ({ source, ref: { tracker: 'linear' as const, key } }) as const

/** An ISO timestamp `minutes` before `now`. */
export const isoMinutesBefore = (now: number, minutes: number): string =>
  new Date(now - minutes * MINUTE).toISOString()

/** The sessions: one agent working with a pull request, one asking, one scratch terminal. */
export const FACTS = [
  fact({
    sessionId: 'building',
    name: 'Claude',
    state: 'working',
    projectId: 'p20',
    branch: 'tav-20',
    workspaceName: 'terminator',
    workItem: ticket('TAV-20'),
    latestLine: 'Writing ReviewHeader tests',
    lastActivityAt: NOW - MINUTE,
    startedAt: new Date(NOW - 38 * MINUTE).toISOString(),
    description: 'Keep the existing risk chip.',
  }),
  fact({
    sessionId: 'asking',
    name: 'Claude',
    state: 'awaiting-input',
    projectId: 'p31',
    branch: 'tav-31',
    workspaceName: 'terminator',
    workItem: ticket('TAV-31'),
    askMessage: 'Run the migration against staging?',
    lastActivityAt: NOW - 4 * MINUTE,
  }),
  fact({
    sessionId: 'scratch',
    name: 'zsh',
    description: 'Scratch shell',
    state: 'idle',
    projectId: null,
    branch: null,
    workspaceName: null,
    projectName: null,
    lastActivityAt: NOW - HOUR,
  }),
]

/** TAV-20's pull request fails a check; TAV-14's is in review with nobody working on it. */
export const FACETS = [
  facet({
    workKey: { repoRoot: REPO_ROOT, branch: 'tav-20' },
    title: 'PR overview shows status before story',
    stage: 'in-review',
    whoseMove: 'agents',
    tone: 'bad',
    line: '#275 checks failing',
    url: 'https://github.com/o/r/pull/275',
    checks: [
      { name: 'End-to-end tests', state: 'failed', detail: '2 of 14 failed' },
      { name: 'Unit tests', state: 'passed' },
    ],
    updatedAt: new Date(NOW - 20 * MINUTE).toISOString(),
  }),
  facet({
    workKey: { repoRoot: REPO_ROOT, branch: 'tav-14' },
    title: 'Make all text in the app scale with settings',
    stage: 'in-review',
    whoseMove: 'others',
    tone: 'good',
    line: '#271 checks passed',
    updatedAt: new Date(NOW - 25 * HOUR).toISOString(),
  }),
]

const issue = (key: string, title: string) =>
  ({
    tracker: 'linear',
    id: key,
    key,
    title,
    url: `https://linear.app/t/issue/${key}`,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    branchName: null,
  }) as Issue

/** Puts the workspace, tickets and published facets in the stores the Desk reads. */
export function seedDesk(): void {
  useWorkspaceStore.setState({
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([['ws1', [project('p20', 'tav-20'), project('p31', 'tav-31')]]]),
  })
  useIntegrationsStore.setState({
    issuesByKey: new Map([
      ['linear:TAV-20', issue('TAV-20', 'PR overview shows status before story')],
      ['linear:TAV-31', issue('TAV-31', 'Reproduce staging 429s before release')],
    ]),
  })
  useHomeFeedStore.setState({ asks: [], facets: FACETS, measures: [], focus: [] })
}

/** What git-integration publishes for a failing pull request: an ask carrying Send to agent. */
export const sendToAgentAsk: MergedHomeFeed['asks'][number] = {
  id: 'fix:o/r#275',
  kind: 'fix',
  title: 'Check failed',
  detail: '',
  facts: [],
  workKey: { repoRoot: '/repos/terminator', branch: 'tav-20' },
  since: new Date(NOW).toISOString(),
  actions: [{ id: 'send-to-agent', label: 'Send to agent' }],
  open: { command: 'x' },
  source: 'git-integration',
}
