import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThreadDrawer } from '../../../../src/renderer/components/home/ThreadDrawer'
import { useDeskSelection } from '../../../../src/renderer/components/home/desk-selection'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useParkedThreads } from '../../../../src/renderer/components/home/parked-threads'
import { installElectronApi } from '../../../support/electron-api'
import { FACETS, FACTS, seedDesk, ticket } from '../home/desk-world'
import { fact } from '../sidebar/fixtures/facts'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const spies = vi.hoisted(() => ({
  open: vi.fn(),
  facts: [] as SessionFacts[],
}))
vi.mock('../../../../src/renderer/components/session/LivePreview', () => ({
  LivePreview: function StubPreview({ sessionId }: { sessionId: string }) {
    return <div data-testid={`preview-${sessionId}`} />
  },
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => spies.facts,
}))
vi.mock('../../../../src/renderer/components/session/session-actions', () => ({
  SESSION_ACTIONS: { onOpen: spies.open },
}))

const summaryGet = vi.fn()
const usageGet = vi.fn()
const openExternal = vi.fn()

function resetDrawerWorld(): void {
  localStorage.clear()
  spies.facts = FACTS
  seedDesk()
  useDeskSelection.setState({ selectedThreadKey: null, openThreadKey: null, groupBy: 'move' })
  useDeskSelection.setState({ expandedGroupIds: [] })
  useParkedThreads.setState({ keys: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDrawerWorld()
  summaryGet.mockResolvedValue({ text: 'Two agents are on this.', generatedAt: 'now' })
  usageGet.mockResolvedValue({ data: { sessions: [], totals: {} } })
  installElectronApi({
    homeThreadSummary: { get: summaryGet },
    agentUsage: { get: usageGet },
    shell: { openExternal },
  })
})

function openDrawerFor(facts: SessionFacts[], threadKey: string): void {
  spies.facts = facts
  useDeskSelection.getState().openThread(threadKey)
}

const terminalBox = () => screen.getByRole('button', { name: /terminal full size$/ })

const OPEN_SESSION = {
  sessionId: 's9',
  branch: 'tav-20',
  projectId: 'p20',
  workItem: ticket('TAV-20'),
}

describe('ThreadDrawer terminal section', () => {
  it("shows the lead agent session's live terminal and opens it on click", () => {
    const agent = {
      provider: 'claude',
      sessionId: 'agent-1',
      transcriptPath: '/t.jsonl',
      cwd: '/repos/terminator',
      capturedAt: 'now',
    } as SessionFacts['agent']
    openDrawerFor([fact({ ...OPEN_SESSION, agent })], 'linear:TAV-20')
    render(<ThreadDrawer />)
    expect(screen.getByText('LIVE TERMINAL · claude')).toBeTruthy()
    expect(screen.getByTestId('preview-s9')).toBeTruthy()
    expect(screen.getByText('Click the terminal to open it full size.')).toBeTruthy()
    fireEvent.click(terminalBox())
    expect(spies.open.mock.calls.map(([id]) => id)).toContain('s9')
  })

  it('opens the terminal on Enter from the terminal box', () => {
    openDrawerFor([fact({ ...OPEN_SESSION })], 'linear:TAV-20')
    render(<ThreadDrawer />)
    fireEvent.keyDown(terminalBox(), { key: 'Enter' })
    expect(spies.open.mock.calls.map(([id]) => id)).toContain('s9')
  })

  it('names a shell session by its shell basename', () => {
    openDrawerFor([fact({ ...OPEN_SESSION, shell: '/bin/zsh' })], 'linear:TAV-20')
    render(<ThreadDrawer />)
    expect(screen.getByText('LIVE TERMINAL · zsh')).toBeTruthy()
  })
})

describe('ThreadDrawer terminal section lifecycle', () => {
  it('shows no terminal section when every session is closed', () => {
    openDrawerFor([fact({ ...OPEN_SESSION, isClosed: true })], 'linear:TAV-20')
    render(<ThreadDrawer />)
    expect(screen.queryByTestId('preview-s9')).toBeNull()
    expect(screen.queryByText(/^LIVE TERMINAL/)).toBeNull()
  })

  it('unmounts the preview when the drawer closes', () => {
    openDrawerFor([fact({ ...OPEN_SESSION })], 'linear:TAV-20')
    const { unmount } = render(<ThreadDrawer />)
    expect(screen.getByTestId('preview-s9')).toBeTruthy()
    unmount()
    expect(screen.queryByTestId('preview-s9')).toBeNull()
  })
})

describe('ThreadDrawer links', () => {
  it('shows a button for each link a facet publishes and opens its address', () => {
    const url = 'https://claude.ai/artifact/abc'
    useHomeFeedStore.setState({
      facets: [
        ...FACETS,
        {
          ...FACETS[0],
          source: 'foundry',
          kind: 'order',
          links: [{ label: 'Open artifact', url }],
        },
      ],
    })
    openDrawerFor([fact({ ...OPEN_SESSION })], 'linear:TAV-20')
    render(<ThreadDrawer />)
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact' }))
    expect(openExternal).toHaveBeenCalledWith(url)
  })
})
