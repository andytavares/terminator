import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { fact } from '../../sidebar/fixtures/facts'
import { installElectronApi } from '../../../../support/electron-api'
import type { SessionFacts } from '../../../../../src/renderer/sidebar/session-facts'

const state = vi.hoisted(() => ({ facts: [] as SessionFacts[], threads: [] as unknown[] }))

vi.mock('../../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => state.facts,
  useIssueTitles: () => new Map(),
}))
vi.mock('../../../../../src/renderer/components/home/useWorkThreads', () => ({
  useWorkThreads: () => ({ threads: state.threads, groups: [], allThreads: state.threads }),
}))
vi.mock('../../../../../src/renderer/components/home/InFlight', () => ({
  InFlight: () => <div>In flight rows</div>,
}))
vi.mock('../../../../../src/renderer/components/home/TodayRail', () => ({
  TodayRail: () => <div>Today rail</div>,
}))
vi.mock('../../../../../src/renderer/components/home/TicketsColumn', () => ({
  TicketsColumn: () => <div>Tickets column</div>,
}))
vi.mock('../../../../../src/renderer/components/home/Insights', () => ({
  Insights: () => <div>Insights view</div>,
}))
vi.mock('../../../../../src/renderer/components/home/InsightsBar', () => ({
  InsightsBar: () => <div>Insights window</div>,
}))
vi.mock('../../../../../src/renderer/components/home/TaskList', () => ({
  TaskList: () => <section aria-label="Tasks">Task rows</section>,
  ArchivedTasks: () => <button type="button">Archived tasks (0)</button>,
}))
vi.mock('../../../../../src/renderer/components/home/StateGlyph', () => ({
  StateGlyph: (props: { state: string; inferred?: boolean }) => (
    <span role="img" aria-label={props.inferred ? `${props.state}, inferred` : props.state} />
  ),
}))

import { HomeScreen } from '../../../../../src/renderer/components/home/HomeScreen'
import { useHomeFeedStore } from '../../../../../src/renderer/stores/home-feed.store'
import { useHomeView } from '../../../../../src/renderer/components/home/home-view'
import { useDeskFilter } from '../../../../../src/renderer/components/home/desk-filter'
import { useDismissalsStore } from '../../../../../src/renderer/home/dismissals'
import { useFocusStore } from '../../../../../src/renderer/home/focus-store'
import { useSettingsStore } from '../../../../../src/renderer/stores/settings.store'
import { useIntegrationsStore } from '../../../../../src/renderer/stores/integrations.store'
import { defaultGlobalSettings } from '../../../../../src/shared/settings-defaults'
import type { HomeLayout } from '../../../../../src/shared/schemas/settings.schema'

const NOW = Date.now()

const asking = (patch: Partial<SessionFacts> = {}): SessionFacts =>
  fact({
    sessionId: 'a',
    state: 'awaiting-input',
    lastActivityAt: NOW - 4 * 60_000,
    askMessage: 'Run the migration against staging?',
    ...patch,
  })

const thread = (key: string, taskState: string, sessionState = 'idle') => ({
  key,
  title: key,
  state: taskState,
  archived: false,
  facets: [],
  lanes: [],
  sessions: [{ state: sessionState }],
})

function useLayout(layout: HomeLayout): void {
  const defaults = defaultGlobalSettings('/bin/zsh')
  useSettingsStore.setState({
    globalSettings: { ...defaults, ui: { ...defaults.ui, homeLayout: layout } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  state.facts = []
  state.threads = []
  useDeskFilter.getState().clear()
  installElectronApi({
    terminal: { input: vi.fn() },
    attention: { measures: vi.fn().mockResolvedValue({ data: { waitedOnYouToday: 0 } }) } as never,
  })
  useHomeFeedStore.setState({ asks: [], facets: [], measures: [], focus: [] })
  useHomeView.setState({ view: 'desk' })
  useDismissalsStore.setState({ entries: {} })
  useFocusStore.setState({ days: {}, planDismissedOn: null })
  useIntegrationsStore.setState({ connections: [] })
  useLayout('tasks')
})

const home = () => screen.getByRole('region', { name: 'Home' })

describe('Home — the layout setting', () => {
  it('draws Needs you above Tasks and no In flight region in the Tasks layout', () => {
    state.facts = [asking()]
    render(<HomeScreen />)
    const needsYou = screen.getByRole('region', { name: 'Needs you' })
    const tasks = screen.getByRole('region', { name: 'Tasks' })
    expect(needsYou.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('In flight rows')).toBeNull()
    expect(screen.queryByText('Today rail')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeTruthy()
  })

  it('still draws In flight and Your move in the Classic layout', () => {
    useLayout('classic')
    state.facts = [asking()]
    render(<HomeScreen />)
    expect(screen.getByText('In flight rows')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Your move' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
  })

  it('calls the Desk view Today in the Tasks layout and Desk in Classic', () => {
    const { unmount } = render(<HomeScreen />)
    expect(screen.getByRole('radio', { name: 'Today' })).toBeTruthy()
    unmount()
    useLayout('classic')
    render(<HomeScreen />)
    expect(screen.getByRole('radio', { name: 'Desk' })).toBeTruthy()
  })
})

describe('Home — the pulse line', () => {
  it('shows only the states that have tasks, with their counts', () => {
    state.threads = [
      thread('a', 'running', 'working'),
      thread('b', 'running', 'working'),
      thread('c', 'quiet'),
    ]
    render(<HomeScreen />)
    const pulse = screen.getByRole('group', { name: 'Task states' })
    expect(within(pulse).getByRole('button', { name: '2 running' })).toBeTruthy()
    expect(within(pulse).getByRole('button', { name: '1 quiet' })).toBeTruthy()
    expect(within(pulse).queryByRole('button', { name: /need you|waiting|done/ })).toBeNull()
  })

  it('counts the queue as the tasks that need you', () => {
    state.facts = [asking(), asking({ sessionId: 'b' })]
    render(<HomeScreen />)
    expect(screen.getByRole('button', { name: '2 need you' })).toBeTruthy()
  })
})

describe('Home — the pulse line as a filter', () => {
  it('narrows to one state when its count is pressed, and back when pressed again', () => {
    state.facts = [asking()]
    state.threads = [thread('a', 'running', 'working')]
    render(<HomeScreen />)
    const running = screen.getByRole('button', { name: '1 running' })
    fireEvent.click(running)
    expect(running.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeTruthy()
    fireEvent.click(running)
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeTruthy()
  })

  it('narrows to the queue when Needs you is pressed', () => {
    state.facts = [asking()]
    state.threads = [thread('a', 'running', 'working')]
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: '1 need you' }))
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Tasks' })).toBeNull()
  })
})

describe('Home — Needs you', () => {
  it('draws an inferred ask with the inferred glyph and says why it is a guess', () => {
    state.facts = [asking({ askInferred: true, askSignal: 'choice' })]
    render(<HomeScreen />)
    const queue = screen.getByRole('region', { name: 'Needs you' })
    expect(within(queue).getByRole('img', { name: 'needs-you, inferred' })).toBeTruthy()
    expect(within(queue).getByText(/a numbered choice is on screen/)).toBeTruthy()
  })
})

describe('Home — Needs you, the reasons and the calm line', () => {
  it('says the terminal rang its bell for an ask that came from a bell', () => {
    state.facts = [asking({ askInferred: true, askSignal: 'bell' })]
    render(<HomeScreen />)
    expect(screen.getByText(/the terminal rang its bell/)).toBeTruthy()
  })

  it('draws a reported ask without a reason', () => {
    state.facts = [asking()]
    render(<HomeScreen />)
    expect(screen.queryByText(/on screen|rang its bell/)).toBeNull()
  })

  it('opens the first ask with its answers and lists the rest on one line', () => {
    state.facts = [asking(), asking({ sessionId: 'b', lastActivityAt: NOW - 60_000 })]
    render(<HomeScreen />)
    expect(screen.getAllByLabelText('Terminal excerpt')).toHaveLength(1)
    fireEvent.keyDown(home(), { key: 'j' })
    expect(screen.getAllByLabelText('Terminal excerpt')).toHaveLength(1)
  })

  it('shows one dashed line and how many agents run when nothing needs you', () => {
    state.threads = [thread('a', 'running', 'working'), thread('b', 'running', 'working')]
    render(<HomeScreen />)
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
    expect(screen.getByText('Nothing needs you.')).toBeTruthy()
    expect(screen.getByText(/2 agents are running/)).toBeTruthy()
  })
})

describe('Home — the plan', () => {
  it('shows the plan strip, and Skip today takes it away', () => {
    render(<HomeScreen />)
    expect(document.body.textContent).toContain(
      'Plan today · 0 tasks carried over · pick up to 3 to focus on'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skip today' }))
    expect(document.body.textContent).not.toContain('pick up to 3 to focus on')
  })
})

describe('Home — the plan sheet', () => {
  it('opens the plan sheet with P and closes it with Escape', async () => {
    render(<HomeScreen />)
    expect(screen.queryByRole('dialog', { name: 'Plan today' })).toBeNull()
    fireEvent.keyDown(home(), { key: 'p' })
    const sheet = await screen.findByRole('dialog', { name: 'Plan today' })
    expect(within(sheet).getByText(/Today's focus/i)).toBeTruthy()
    within(sheet).getAllByRole('button')[0].focus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Plan today' })).toBeNull())
  })

  it('opens the plan sheet from the Plan button', async () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: /^Plan/ }))
    expect(await screen.findByRole('dialog', { name: 'Plan today' })).toBeTruthy()
  })
})

describe('Home — the plan sheet and trackers', () => {
  it('leaves out the tickets column when no tracker is connected', async () => {
    render(<HomeScreen />)
    fireEvent.keyDown(home(), { key: 'p' })
    const sheet = await screen.findByRole('dialog', { name: 'Plan today' })
    expect(within(sheet).queryByText('Tickets column')).toBeNull()
    expect(within(sheet).getByText(/Connect Linear/)).toBeTruthy()
  })

  it('draws the tickets column once a tracker is connected', async () => {
    useIntegrationsStore.setState({
      connections: [{ tracker: 'linear', connected: true } as never],
    })
    render(<HomeScreen />)
    fireEvent.keyDown(home(), { key: 'p' })
    const sheet = await screen.findByRole('dialog', { name: 'Plan today' })
    expect(within(sheet).getByText('Tickets column')).toBeTruthy()
    expect(within(sheet).queryByText(/Connect Linear/)).toBeNull()
  })
})

describe('Home — the plan sheet, continued', () => {
  it('says how many agents already run across how many tasks', async () => {
    state.threads = [thread('a', 'running', 'working'), thread('b', 'running', 'working')]
    render(<HomeScreen />)
    fireEvent.keyDown(home(), { key: 'p' })
    expect(await screen.findByText('Already running: 2 agents across 2 tasks.')).toBeTruthy()
  })
})

describe('Home — the footer', () => {
  it('links to Insights and offers the archived tasks', () => {
    render(<HomeScreen />)
    expect(screen.getByRole('button', { name: 'Archived tasks (0)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Open Insights/ }))
    expect(useHomeView.getState().view).toBe('insights')
  })
})
