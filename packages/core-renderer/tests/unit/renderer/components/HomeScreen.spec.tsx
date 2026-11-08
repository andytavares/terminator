import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fact } from '../sidebar/fixtures/facts'
import { isoMinutesBefore } from '../home/desk-world'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { resetStore } from '../../../../../test-support/src/renderer-stores'
import type { SessionFacts } from '../../../../src/sidebar/session-facts'
import type { HomeAsk } from '../../../../../core-shared/src/schemas/home-feed.schema'

const state = vi.hoisted(() => ({
  facts: [] as SessionFacts[],
  threads: [] as unknown[],
  tickets: [] as unknown[],
}))
const answer = vi.hoisted(() => vi.fn(() => true))
const reveal = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/components/session/useSessionFacts', () => ({
  useSessionFacts: () => state.facts,
  useIssueTitles: () => new Map(),
}))
vi.mock('../../../../src/components/home/useWorkThreads', () => ({
  useWorkThreads: () => ({
    threads: state.threads,
    groups: [],
    allThreads: state.threads,
    dismissedThreads: [],
  }),
}))
vi.mock('../../../../src/components/home/start-work-model', () => ({
  useMyTickets: () => state.tickets,
}))
vi.mock('../../../../src/terminal/session-controller', () => ({ answerChoice: answer }))
vi.mock('../../../../src/terminal/navigate-to-session', () => ({ revealSession: reveal }))
vi.mock('../../../../src/components/home/InFlight', () => ({
  InFlight: () => <div>In flight rows</div>,
}))
vi.mock('../../../../src/components/home/TodayRail', () => ({
  TodayRail: () => <div>Today rail</div>,
}))
vi.mock('../../../../src/components/home/PlanTheDay', () => ({
  PlanTheDay: () => null,
}))
vi.mock('../../../../src/components/home/Insights', () => ({
  Insights: () => <div>Insights view</div>,
}))
vi.mock('../../../../src/components/home/ScheduledView', () => ({
  ScheduledView: () => <div>Scheduled view</div>,
}))
vi.mock('../../../../src/components/home/InsightsBar', () => ({
  InsightsBar: () => <div>Insights window</div>,
}))

import { HomeScreen } from '../../../../src/components/home/HomeScreen'
import { HomeBadge } from '../../../../src/components/AppShellParts'
import { useHomeFeedStore } from '../../../../src/stores/home-feed.store'
import { useHomeView } from '../../../../src/components/home/home-view'
import { useDeskSelection } from '../../../../src/components/home/desk-selection'
import { useDismissalsStore } from '../../../../src/home/dismissals'
import { useDeskFilter } from '../../../../src/components/home/desk-filter'
import { useStartWorkStore } from '../../../../src/components/home/start-work'
import { useChangeStatsStore } from '../../../../src/stores/change-stats.store'
import { useFocusStore } from '../../../../src/home/focus-store'
import { localDateKey } from '../../../../src/home/focus'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useExtensionRegistry } from '../../../../src/extensions/registry'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { defaultGlobalSettings } from '../../../../../core-shared/src/settings-defaults'

const NOW = Date.now()

const REVIEW_ASK: HomeAsk & { source: string } = {
  id: '',
  kind: 'review',
  title: 'Review requested',
  detail: 'Add offline cache',
  facts: [],
  workKey: null,
  since: isoMinutesBefore(NOW, 30),
  actions: [{ id: 'start-review', label: 'Start review', primary: true }],
  open: { command: 'open' },
  source: 'git-integration',
}

const homeFeedAsk = (patch: Partial<HomeAsk> & { id: string }): HomeAsk & { source: string } => ({
  ...REVIEW_ASK,
  ...patch,
})

const asking = (): SessionFacts =>
  fact({
    sessionId: 'a',
    state: 'awaiting-input',
    lastActivityAt: NOW - 4 * 60_000,
    choicePrompt: {
      question: 'Run the migration against staging?',
      options: [
        { number: 1, label: 'Yes' },
        { number: 2, label: 'No, stop here' },
      ],
    } as SessionFacts['choicePrompt'],
  })

let input: Mock<(sessionId: string, data: string) => void>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  state.facts = []
  state.threads = []
  state.tickets = []
  useDeskFilter.getState().clear()
  input = vi.fn()
  installElectronApi({
    terminal: { input },
    attention: {
      measures: vi.fn().mockResolvedValue({ data: { waitedOnYouToday: 14 } }),
    } as never,
  })
  useHomeFeedStore.setState({ asks: [], facets: [], measures: [], focus: [] })
  useHomeView.setState({ view: 'desk' })
  useDeskSelection.setState({ selectedThreadKey: null, openThreadKey: null })
  useDismissalsStore.setState({ entries: {} })
  useStartWorkStore.setState({ open: false })
  useFocusStore.setState({ days: {} })
  resetStore(useExtensionRegistry)
  // These specs cover the Classic Desk; the Tasks layout has its own spec.
  const defaults = defaultGlobalSettings('/bin/zsh')
  useSettingsStore.setState({
    globalSettings: { ...defaults, ui: { ...defaults.ui, homeLayout: 'classic' } },
  })
  useSessionStore.setState({
    getTerminalInstance: () =>
      ({ readVisibleRows: () => ['Do you want to run it?', '❯ 1. Yes', '', ''] }) as never,
  })
})

const home = () => screen.getByRole('region', { name: 'Home' })
const askRows = () => within(screen.getByRole('list')).getAllByRole('listitem')

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

describe('HomeScreen — the Quiet desk', () => {
  it('hides the band and says nothing needs you when no ask is waiting', () => {
    render(<HomeScreen />)
    expect(screen.queryByRole('region', { name: 'Your move' })).toBeNull()
    expect(screen.getByText('Nothing needs you.')).toBeTruthy()
    expect(screen.getByText(/Done today: 0/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Foundry/)
  })

  it.each([
    ['the header', 0],
    ['the quiet line', 1],
  ])('opens the Start work launcher from %s', async (_place, buttonIndex) => {
    const user = userEvent.setup()
    render(<HomeScreen />)
    await user.click(screen.getAllByRole('button', { name: /Start work/ })[buttonIndex])
    expect(useStartWorkStore.getState().open).toBe(true)
  })
})

describe('HomeScreen — the Your move band', () => {
  it('lists asks by kind then age, each with its own title and main action', () => {
    state.facts = [asking()]
    useHomeFeedStore.setState({
      asks: [
        homeFeedAsk({ id: 'r1', since: isoMinutesBefore(NOW, 180) }),
        homeFeedAsk({
          id: 'f1',
          kind: 'fix',
          title: 'Check failed',
          detail: 'End-to-end tests: 2 of 14 failed',
          facts: ['review-header.spec.ts'],
          actions: [{ id: 'send-to-agent', label: 'Send to agent', primary: true }],
        }),
      ],
    })
    render(<HomeScreen />)
    expect(screen.getByRole('heading', { name: 'Your move · 3' })).toBeTruthy()
    const titles = askRows().map(
      (row) => within(row).getByText(/Agent is asking|Check failed|Review requested/).textContent
    )
    expect(titles).toEqual(['Agent is asking', 'Check failed', 'Review requested'])
    expect(within(askRows()[1]).getByText(/review-header.spec.ts/)).toBeTruthy()
    expect(within(askRows()[1]).getByRole('button', { name: 'Send to agent' })).toBeTruthy()
  })
})

describe('HomeScreen — acting on an ask', () => {
  it('answers a numbered choice in the session that asked', async () => {
    const user = userEvent.setup()
    state.facts = [asking()]
    render(<HomeScreen />)
    await user.click(screen.getByRole('button', { name: /No, stop here/ }))
    expect(answer).toHaveBeenCalledWith('a', 2)
  })

  it('runs an extension ask action against the extension that published it', async () => {
    const user = userEvent.setup()
    const runAction = vi.fn().mockResolvedValue(true)
    useHomeFeedStore.setState({ asks: [homeFeedAsk({ id: 'r1' })], runAction })
    render(<HomeScreen />)
    await user.click(screen.getByRole('button', { name: 'Start review' }))
    expect(runAction).toHaveBeenCalledWith('git-integration', 'r1', 'start-review')
  })
})

describe('HomeScreen — dismissing an ask', () => {
  it('marks an ask done with E and drops its row, counting it in Done today', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({
      asks: [
        homeFeedAsk({ id: 'r1' }),
        homeFeedAsk({ id: 'r2', title: 'Re-review requested', since: isoMinutesBefore(NOW, 10) }),
      ],
    })
    render(<HomeScreen />)
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('e')
    expect(askRows()).toHaveLength(1)
    expect(screen.queryByText('Review requested')).toBeNull()
    expect(screen.getByText('Done today: 1')).toBeTruthy()
  })

  it('snoozes with H and the chosen time, and says how many are snoozed', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({
      asks: [homeFeedAsk({ id: 'r1' }), homeFeedAsk({ id: 'r2', title: 'Other' })],
    })
    render(<HomeScreen />)
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('h')
    await user.click(screen.getByRole('menuitem', { name: 'Tomorrow' }))
    expect(askRows()).toHaveLength(1)
    expect(screen.getByText(/1 snoozed until 9 AM/)).toBeTruthy()
  })
})

describe('HomeScreen — answering in place', () => {
  it('opens the ask on Enter with the terminal excerpt, and sends a reply with Enter', async () => {
    const user = userEvent.setup()
    state.facts = [asking()]
    render(<HomeScreen />)
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Terminal excerpt').textContent).toContain('❯ 1. Yes')
    const reply = screen.getByRole('textbox', { name: 'Reply in your own words' })
    await user.type(reply, 'use staging{Enter}')
    expect(input).toHaveBeenCalledWith('a', '\x1b[200~use staging\x1b[201~\r')
  })

  it('answers with a number key and closes with Escape', async () => {
    const user = userEvent.setup()
    state.facts = [asking()]
    render(<HomeScreen />)
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Terminal excerpt')).toBeNull()
    await user.keyboard('1')
    expect(answer).toHaveBeenCalledWith('a', 1)
  })
})

describe('HomeScreen — a finished agent', () => {
  it('shows what it changed, read from its branch', async () => {
    const user = userEvent.setup()
    state.facts = [
      fact({
        sessionId: 'f',
        state: 'idle',
        agent: {} as SessionFacts['agent'],
        lastActivityAt: NOW - 41 * 60_000,
        turnEndedAt: NOW - 41 * 60_000,
      }),
    ]
    useChangeStatsStore.setState({
      entries: new Map([
        ['p1', { stats: { files: 4, added: 210, removed: 8 }, fetchedAt: NOW, state: 'ready' }],
      ]),
    })
    render(<HomeScreen />)
    expect(within(askRows()[0]).getByText('Agent finished')).toBeTruthy()
    expect(within(askRows()[0]).getByText(/4 files · \+210 −8/)).toBeTruthy()
    await user.click(within(askRows()[0]).getByRole('button', { name: 'Review changes' }))
    expect(reveal).toHaveBeenCalledWith('f')
  })
})

describe('HomeScreen — keys', () => {
  it('moves the selection with J and K', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({
      asks: [
        homeFeedAsk({ id: 'r1' }),
        homeFeedAsk({ id: 'r2', since: isoMinutesBefore(NOW, 10) }),
      ],
    })
    render(<HomeScreen />)
    const selectedRowIndex = () =>
      askRows().findIndex((row) => within(row).queryByRole('generic', { current: true }))
    expect(selectedRowIndex()).toBe(0)
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('j')
    expect(selectedRowIndex()).toBe(1)
    await user.keyboard('k')
    expect(selectedRowIndex()).toBe(0)
  })

  it('ignores single-letter keys typed in a field', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({ asks: [homeFeedAsk({ id: 'r1' })] })
    render(<HomeScreen />)
    await user.type(screen.getByRole('searchbox', { name: 'Search work' }), 'e')
    expect(askRows()).toHaveLength(1)
  })
})

describe('HomeScreen — keys — search', () => {
  it('moves focus to the search field on Command K', async () => {
    const user = userEvent.setup()
    render(<HomeScreen />)
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByRole('searchbox', { name: 'Search work' }).matches(':focus')).toBe(true)
  })
})

const bareThread = {
  sessions: [],
  facets: [],
  archived: false,
  state: 'running',
  lanes: [],
}
describe('HomeScreen — the summary line', () => {
  it('shows each count that is not zero and leaves out the rest', () => {
    useHomeFeedStore.setState({ asks: [homeFeedAsk({ id: 'r1' }), homeFeedAsk({ id: 'r2' })] })
    render(<HomeScreen />)
    const summary = screen.getByRole('group', { name: 'Summary' })
    expect(within(summary).getByRole('button', { name: '2 your move' })).toBeTruthy()
    expect(within(summary).queryByText(/agents working/)).toBeNull()
    expect(within(summary).queryByText(/failing check/)).toBeNull()
  })

  it('counts agents working and failing checks, singular and plural', () => {
    const working = {
      ...bareThread,
      sessions: [{ state: 'working' }],
    }
    const failing = {
      ...bareThread,
      facets: [{ kind: 'pull-request', tone: 'bad' }],
      state: 'waiting',
    }
    state.threads = [working, failing]
    render(<HomeScreen />)
    const summary = screen.getByRole('group', { name: 'Summary' })
    expect(within(summary).getByRole('button', { name: '1 agent working' })).toBeTruthy()
    expect(within(summary).getByRole('button', { name: '1 failing check' })).toBeTruthy()
    expect(within(summary).getByRole('button', { name: '1 waiting on others' })).toBeTruthy()
  })
})

describe('HomeScreen — the summary line, right side', () => {
  it("shows today's focus progress when anything is picked", () => {
    const day = localDateKey(Date.now())
    const focusItem = (id: string, doneByHand: boolean) => ({ id, title: id, doneByHand })
    useFocusStore.setState({ days: { [day]: [focusItem('a', true), focusItem('b', false)] } })
    render(<HomeScreen />)
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('says how long agents waited on you today', async () => {
    render(<HomeScreen />)
    expect(await screen.findByText('14 min')).toBeTruthy()
  })

  it('narrows to the band when its count is pressed', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({ asks: [homeFeedAsk({ id: 'r1' })] })
    render(<HomeScreen />)
    await user.click(screen.getByRole('button', { name: '1 your move' }))
    expect(screen.queryByText('In flight rows')).toBeNull()
    expect(askRows()).toHaveLength(1)
  })
})

describe('HomeScreen — Desk and Insights', () => {
  it('shows Insights in place of the Desk, and G then D brings the Desk back', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({ asks: [homeFeedAsk({ id: 'r1' })] })
    render(<HomeScreen />)
    await user.click(screen.getByRole('radio', { name: 'Insights' }))
    expect(await screen.findByText('Insights view')).toBeTruthy()
    expect(screen.getByText('Insights window')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start work/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Your move' })).toBeNull()
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('g')
    await user.keyboard('d')
    expect(screen.queryByText('Insights view')).toBeNull()
    expect(askRows()).toHaveLength(1)
  })
})

describe('HomeScreen — Scheduled', () => {
  it('shows the Scheduled view from its segment and from G then S', async () => {
    const user = userEvent.setup()
    render(<HomeScreen />)
    await user.click(screen.getByRole('radio', { name: 'Scheduled' }))
    expect(await screen.findByText('Scheduled view')).toBeTruthy()
    expect(screen.queryByRole('searchbox', { name: 'Search work' })).toBeNull()
    expect(home().matches(':focus-within')).toBe(true)
    await user.keyboard('g')
    await user.keyboard('d')
    expect(screen.queryByText('Scheduled view')).toBeNull()
    await user.keyboard('g')
    await user.keyboard('s')
    expect(await screen.findByText('Scheduled view')).toBeTruthy()
  })

  it('opens Start work for a new scheduled run on a repeat from the header', async () => {
    const user = userEvent.setup()
    useHomeView.setState({ view: 'scheduled' })
    render(<HomeScreen />)
    await user.click(screen.getByRole('button', { name: 'New scheduled run' }))
    expect(useStartWorkStore.getState()).toMatchObject({ open: true, repeat: true, editing: null })
  })
})

describe('HomeBadge', () => {
  it('counts every ask waiting on you, from core and from extensions', () => {
    state.facts = [asking()]
    useHomeFeedStore.setState({ asks: [homeFeedAsk({ id: 'r1' })] })
    useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.home',
      label: 'Home',
      icon: null,
      component: () => null,
    })
    render(<HomeBadge />)
    const tab = useExtensionRegistry.getState().globalTabs.get('core.home')
    expect(tab?.badge).toBe(2)
    expect(tab?.badgeLabel).toBe('2 need you')
  })
})

const searchFor = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const searchbox = screen.getByRole('searchbox', { name: 'Search work' })
  await user.clear(searchbox)
  await user.type(searchbox, text)
}

describe('HomeScreen — search', () => {
  it('narrows the band to the asks that match what was typed', async () => {
    const user = userEvent.setup()
    useHomeFeedStore.setState({
      asks: [
        homeFeedAsk({ id: 'r1' }),
        homeFeedAsk({ id: 'r2', detail: 'Fix the tests', title: 'Check failed' }),
      ],
    })
    render(<HomeScreen />)
    await searchFor(user, 'offline')
    expect(askRows()).toHaveLength(1)
    expect(screen.getByText('Add offline cache')).toBeTruthy()
  })
})

function seedRateMatches(): void {
  state.threads = [
    {
      ...bareThread,
      key: 't1',
      title: 'Rate limit',
      ticketKey: 'TAV-31',
      lanes: [{ repoName: 'cli', branch: 'rl' }],
    },
  ]
  state.facts = [fact({ sessionId: 's9', name: 'rate shell', branch: 'rl' })]
  state.tickets = [{ key: 'TAV-40', title: 'Rate card', tracker: 'linear' }]
}

const pickResult = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  const results = within(screen.getByRole('listbox', { name: 'Search results' }))
  await user.click(results.getByRole('button', { name }))
}

describe('HomeScreen — search results', () => {
  it('opens a matching session in its terminal', async () => {
    const user = userEvent.setup()
    seedRateMatches()
    render(<HomeScreen />)
    await searchFor(user, 'rate')
    await pickResult(user, /rate shell/)
    expect(reveal).toHaveBeenCalledWith('s9')
  })

  it('opens a matching thread on the Desk', async () => {
    const user = userEvent.setup()
    seedRateMatches()
    render(<HomeScreen />)
    await searchFor(user, 'rate')
    await pickResult(user, /Rate limit/)
    expect(useDeskSelection.getState().openThreadKey).toBe('t1')
  })

  it('starts work on a matching ticket', async () => {
    const user = userEvent.setup()
    seedRateMatches()
    render(<HomeScreen />)
    await searchFor(user, 'rate')
    await pickResult(user, /Rate card/)
    expect(useStartWorkStore.getState().prefill).toBe('TAV-40')
  })
})

describe('HomeScreen — search results, continued', () => {
  it('leaves out a ticket a thread already covers', async () => {
    const user = userEvent.setup()
    state.threads = [{ ...bareThread, key: 't1', title: 'Rate limit', ticketKey: 'TAV-31' }]
    state.tickets = [{ key: 'TAV-31', title: 'Rate limit ticket', tracker: 'linear' }]
    render(<HomeScreen />)
    await searchFor(user, 'rate')
    expect(screen.queryByRole('button', { name: /Rate limit ticket/ })).toBeNull()
  })

  it('offers Start work on the text as the last row, and Enter takes it when nothing matches', async () => {
    const user = userEvent.setup()
    render(<HomeScreen />)
    await searchFor(user, 'zzz nothing')
    await user.type(screen.getByRole('searchbox', { name: 'Search work' }), '{Enter}')
    expect(useStartWorkStore.getState().open).toBe(true)
    expect(useStartWorkStore.getState().prefill).toBe('zzz nothing')
  })
})

// Home loads lazily, so it can mount after the person has already reached for a menu.
const outsideHome: HTMLElement[] = []

afterEach(() => {
  outsideHome.splice(0).forEach((element) => element.remove())
})

function focusedOutside(attributes: Record<string, string>): HTMLElement {
  const button = Object.assign(document.createElement('button'), { textContent: 'Display' })
  for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value)
  document.body.append(button)
  outsideHome.push(button)
  button.focus()
  return button
}

describe('focus when Home mounts', () => {
  it('takes focus from a plain button, so its keys work at once', () => {
    focusedOutside({})
    render(<HomeScreen />)
    expect(home().matches(':focus')).toBe(true)
  })

  it('leaves focus on a menu button', () => {
    const trigger = focusedOutside({ 'aria-haspopup': 'menu' })
    render(<HomeScreen />)
    expect(trigger.matches(':focus')).toBe(true)
  })
})

describe('focus when Home mounts inside a popover', () => {
  it('leaves focus inside an open popover', () => {
    const surface = document.createElement('div')
    surface.setAttribute('popover', 'auto')
    // jsdom has no showPopover() and hides a closed popover, whose content cannot take focus.
    surface.style.display = 'block'
    document.body.append(surface)
    outsideHome.push(surface)
    const item = document.createElement('button')
    surface.append(item)
    item.focus()
    render(<HomeScreen />)
    expect(item.matches(':focus')).toBe(true)
  })
})
