import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { HomeScreen } from '../../../../src/components/home/HomeScreen'
import { parseChoicePrompt } from '../../../../src/sidebar/choice-prompt'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useTaskStore } from '../../../../src/stores/task.store'
import { useHomeFeedStore } from '../../../../src/stores/home-feed.store'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { defaultGlobalSettings } from '../../../../../core-shared/src/settings-defaults'
import type { HomeAsk } from '../../../../../core-shared/src/schemas/home-feed.schema'
import type { HomeLayout } from '../../../../../core-shared/src/schemas/settings.schema'
import type { Task } from '../../../../../core-shared/src/schemas/tasks.schema'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import {
  projectFixture,
  resetStore,
  terminalSessionOf,
  workspaceFixture,
} from '../../../../../test-support/src/renderer-stores'

// Home with its real stores, from a terminal's screen to the key that answers it: only the main
// process behind window.electronAPI is fake.

vi.mock('../../../../src/usage/record', () => ({ recordUse: vi.fn() }))

const QUESTION = 'Do you want to create RateLimitBanner.tsx?'
const ASKING_ROWS = [
  ` ${QUESTION}`,
  ' ❯ 1. Yes',
  '   2. Yes, and allow edits this session',
  '   3. No',
]
const REPOS = ['terminator', 'api-gateway', 'web-console']
const BRANCH = 'rate-limits'

const TASK: Task = {
  id: '6f1c1e9e-2b7a-4c55-9d3e-0a4f7c2e8b11',
  title: 'Rate limits across services',
  lanes: REPOS.map((repo) => ({ repoRoot: `/repos/${repo}`, branch: BRANCH })),
  ticket: null,
  focus: false,
  doneAt: null,
  createdAt: '2026-11-08T09:00:00.000Z',
  archivedAt: null,
}

const input = vi.fn()
let screenRows: string[] = []

/** A workspace per repo, each with the task's branch open in a terminal. */
function seedThreeLanes(): void {
  resetStore(useWorkspaceStore, {
    workspaces: REPOS.map((repo) => workspaceFixture({ id: repo, folderPath: `/repos/${repo}` })),
    projectsByWorkspaceId: new Map(
      REPOS.map((repo) => [
        repo,
        [projectFixture({ id: `p-${repo}`, workspaceId: repo, gitBranch: BRANCH })],
      ])
    ),
  })
  resetStore(useSessionStore, {
    sessions: new Map(
      REPOS.map((repo) => [repo, terminalSessionOf({ id: repo, projectId: `p-${repo}` })])
    ),
    getTerminalInstance: () => ({ readVisibleRows: () => screenRows }) as never,
  })
  resetStore(useTaskStore, { tasks: [TASK] })
}

/** The terminal's screen settles on `rows`, as the session controller reports it. */
function screenSettles(sessionId: string, rows: string[]): void {
  screenRows = rows
  act(() =>
    useSessionStore.getState().setSessionScreen(sessionId, {
      latestLine: rows.at(-1) ?? '',
      choicePrompt: parseChoicePrompt(rows),
    })
  )
}

function useLayout(homeLayout: HomeLayout): void {
  const defaults = defaultGlobalSettings('/bin/zsh')
  resetStore(useSettingsStore, {
    globalSettings: { ...defaults, ui: { ...defaults.ui, homeLayout } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  screenRows = []
  installElectronApi({
    terminal: { input },
    attention: { measures: vi.fn().mockResolvedValue({ data: { waitedOnYouToday: 0 } }) } as never,
  })
  resetStore(useHomeFeedStore)
  seedThreeLanes()
})

describe('A numbered question in one lane of a task', () => {
  it('is in Needs you once, and pressing 1 on Home answers it in that terminal', async () => {
    useLayout('tasks')
    const user = userEvent.setup()
    render(<HomeScreen />)
    screenSettles('api-gateway', ASKING_ROWS)

    const tasks = screen.getByRole('region', { name: 'Tasks' })
    expect(within(tasks).getAllByRole('button', { name: TASK.title })).toHaveLength(1)
    const needsYou = await screen.findByRole('region', { name: 'Needs you' })
    expect(within(needsYou).getAllByRole('listitem')).toHaveLength(1)
    expect(within(needsYou).getByText(QUESTION)).toBeTruthy()

    const home = screen.getByRole('region', { name: 'Home' })
    home.focus()
    expect(home.matches(':focus')).toBe(true)
    await user.keyboard('1')
    expect(input).toHaveBeenCalledWith('api-gateway', '1')

    screenSettles('api-gateway', ['answered-1'])
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
    expect(screen.getByText('Nothing needs you.')).toBeTruthy()
  })
})

/** An alert from the api-gateway terminal, as main publishes it to the Home feed. */
function raiseAlert(patch: Partial<HomeAsk>): void {
  useHomeFeedStore.setState({
    asks: [
      {
        source: 'claude-alerts',
        id: 'alert-1',
        kind: 'decide',
        title: 'Agent says',
        detail: '',
        facts: [],
        workKey: null,
        since: new Date().toISOString(),
        actions: [],
        open: { command: 'core:reveal-session', args: { sessionId: 'api-gateway' } },
        ...patch,
      },
    ],
  })
}

describe('An alert a Claude terminal raised with a Reply button', () => {
  // Needs you opens the selected answer row, so the reply field is already showing.
  it("shows that terminal's screen beside the reply field, and sending types the reply into it", async () => {
    useLayout('tasks')
    const user = userEvent.setup()
    screenRows = ['Tests pass. Ship it?']
    raiseAlert({
      kind: 'answer',
      detail: 'Tests pass. Ship it?',
      actions: [{ id: 'reply', label: 'Reply' }],
    })
    render(<HomeScreen />)

    const needsYou = await screen.findByRole('region', { name: 'Needs you' })
    expect(within(needsYou).getByLabelText('Terminal excerpt').textContent).toBe(
      'Tests pass. Ship it?'
    )
    await user.type(
      within(needsYou).getByRole('textbox', { name: 'Reply in your own words' }),
      'yes{Enter}'
    )

    expect(input).toHaveBeenCalledWith('api-gateway', '\x1b[200~yes\x1b[201~\r')
  })
})

describe('An alert with a long detail', () => {
  it('shows its whole detail in the row', async () => {
    useLayout('tasks')
    const detail = `${'The migration touched forty tables. '.repeat(12)}Review before merging.`
    raiseAlert({ detail })
    render(<HomeScreen />)

    const needsYou = await screen.findByRole('region', { name: 'Needs you' })
    expect(within(needsYou).getByText(detail)).toBeTruthy()
  })
})
