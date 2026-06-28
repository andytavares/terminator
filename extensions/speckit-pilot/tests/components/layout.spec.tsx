/**
 * T067 — Tests for Phase 7 layout components: FeaturesView, HistoryView, SettingsView, App sub-nav.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import type { PilotState } from '../../src/types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../../src/types/speckit.types.js'
import type { PhaseId, PhaseState } from '../../src/types/speckit.types.js'

const mockFeatureList = vi.fn()
const mockPilotState = vi.fn()
const mockCredentialsStatus = vi.fn()
const mockCredentialsSet = vi.fn()
const mockOnStateChanged = vi.fn()
const mockOnRunOutput = vi.fn()
const mockOnCheckinReady = vi.fn()
const mockTicketList = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    featureList: mockFeatureList,
    pilotState: mockPilotState,
    credentialsStatus: mockCredentialsStatus,
    credentialsSet: mockCredentialsSet,
    ticketList: mockTicketList,
    onStateChanged: mockOnStateChanged,
    onRunOutput: mockOnRunOutput,
    onCheckinReady: mockOnCheckinReady,
    dispatch: vi.fn().mockResolvedValue({ featureDir: '/repo/specs/001', queued: false }),
    phaseApprove: vi.fn().mockResolvedValue({ state: {} }),
    phaseRevoke: vi.fn().mockResolvedValue({ state: {} }),
    phaseRequestChanges: vi.fn().mockResolvedValue({ state: {} }),
    phaseComment: vi.fn().mockResolvedValue({ ok: true, state: {} }),
    fileWrite: vi.fn().mockResolvedValue({ ok: true }),
    artifactRead: vi.fn().mockResolvedValue({ current: null, approved: null }),
    selfReviewRead: vi.fn().mockResolvedValue({ notFound: true, error: 'no self-review' }),
    openPr: vi.fn().mockResolvedValue({ prUrl: '' }),
    checkinDecision: vi.fn().mockResolvedValue({ ok: true }),
    onDispatchStarted: vi.fn().mockReturnValue(vi.fn()),
  }),
}))

function makePhases(): Record<PhaseId, PhaseState> {
  return Object.fromEntries(
    PHASE_ORDER.map((id) => [
      id,
      {
        id,
        status: 'locked' as const,
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
    ])
  ) as Record<PhaseId, PhaseState>
}

function makeState(overrides?: Partial<PilotState>): PilotState {
  return {
    version: 2,
    featureDir: '/repo/specs/001-eng-1',
    ticket: { source: 'linear', key: 'ENG-1', title: 'Build it', sourceUrl: 'https://l/1' },
    run: null,
    queuePosition: null,
    worktreePath: null,
    branchName: 'feature/eng-1',
    prUrl: null,
    phases: makePhases(),
    settings: DEFAULT_SETTINGS,
    ...overrides,
  } as PilotState
}

const mockExtensionBridgeOn = vi.fn().mockReturnValue(vi.fn())

beforeEach(() => {
  vi.clearAllMocks()
  mockFeatureList.mockResolvedValue({ features: [] })
  mockPilotState.mockResolvedValue({ state: makeState() })
  mockCredentialsStatus.mockResolvedValue({ connected: false })
  mockCredentialsSet.mockResolvedValue({ ok: true })
  mockTicketList.mockResolvedValue({ tickets: [] })
  mockOnStateChanged.mockReturnValue(vi.fn())
  mockOnRunOutput.mockReturnValue(vi.fn())
  mockOnCheckinReady.mockReturnValue(vi.fn())
  mockExtensionBridgeOn.mockReturnValue(vi.fn())
  Object.defineProperty(window, 'electronAPI', {
    value: {
      extensionBridge: {
        on: mockExtensionBridgeOn,
        invoke: vi.fn().mockResolvedValue({}),
      },
    },
    writable: true,
    configurable: true,
  })
})

// --- FeaturesView ---
describe('FeaturesView', () => {
  it('renders "No features" when feature list is empty', async () => {
    const { FeaturesView } = await import('../../src/components/FeaturesView.js')
    render(<FeaturesView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/no features/i)).toBeTruthy()
    })
  })

  it('renders feature rows when features returned', async () => {
    mockFeatureList.mockResolvedValue({
      features: [
        {
          name: '001-build-auth',
          dir: '/repo/specs/001-build-auth',
          specPath: '/repo/specs/001-build-auth/spec.md',
          lastModified: Date.now(),
        },
      ],
    })
    const { FeaturesView } = await import('../../src/components/FeaturesView.js')
    render(<FeaturesView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/001-build-auth/)).toBeTruthy()
    })
  })

  it('renders 10-dot phase rail per feature row', async () => {
    mockFeatureList.mockResolvedValue({
      features: [
        {
          name: '001-test',
          dir: '/repo/specs/001-test',
          specPath: '/repo/specs/001-test/spec.md',
          lastModified: Date.now(),
        },
      ],
    })
    const { FeaturesView } = await import('../../src/components/FeaturesView.js')
    render(<FeaturesView workspacePath="/repo" />)
    await waitFor(() => expect(screen.getByText(/001-test/)).toBeTruthy())
    const dots = screen.getAllByRole('listitem')
    expect(dots.length).toBeGreaterThanOrEqual(10)
  })
})

// --- HistoryView ---
describe('HistoryView', () => {
  it('renders "No completed runs" when no features', async () => {
    mockFeatureList.mockResolvedValue({ features: [] })
    const { HistoryView } = await import('../../src/components/HistoryView.js')
    render(<HistoryView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/no completed/i)).toBeTruthy()
    })
  })

  it('renders table header columns', async () => {
    mockFeatureList.mockResolvedValue({ features: [] })
    const { HistoryView } = await import('../../src/components/HistoryView.js')
    render(<HistoryView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/ticket/i)).toBeTruthy()
      expect(screen.getByText(/status/i)).toBeTruthy()
    })
  })
})

// --- SettingsView ---
describe('SettingsView', () => {
  it('renders "Ticket integrations" section label', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText(/ticket integrations/i)).toBeTruthy()
    })
  })

  it('renders "Autonomy & gates" section label', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getAllByText(/autonomy/i).length).toBeGreaterThan(0)
    })
  })

  it('renders "Agent runner" section label', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByText(/agent runner/i)).toBeTruthy()
    })
  })

  it('shows Linear and Jira connection status', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: true })
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getAllByText(/linear/i).length).toBeGreaterThan(0)
    })
  })

  it('renders Linear API key input field', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText(/linear api key/i)).toBeTruthy()
    })
  })

  it('renders Jira domain, email, and token fields', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText(/jira domain/i)).toBeTruthy()
      expect(screen.getByLabelText(/jira email/i)).toBeTruthy()
      expect(screen.getByLabelText(/jira api token/i)).toBeTruthy()
    })
  })

  it('calls credentialsSet with linear source when Save is clicked', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    mockCredentialsSet.mockResolvedValue({ ok: true })
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => screen.getByLabelText(/linear api key/i))
    fireEvent.change(screen.getByLabelText(/linear api key/i), { target: { value: 'lin_abc123' } })
    fireEvent.click(screen.getByLabelText(/save linear credentials/i))
    await waitFor(() => {
      expect(mockCredentialsSet).toHaveBeenCalledWith({ source: 'linear', apiKey: 'lin_abc123' })
    })
  })

  it('calls credentialsSet with jira source when Jira Save is clicked', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    mockCredentialsSet.mockResolvedValue({ ok: true })
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => screen.getByLabelText(/jira domain/i))
    fireEvent.change(screen.getByLabelText(/jira domain/i), {
      target: { value: 'co.atlassian.net' },
    })
    fireEvent.change(screen.getByLabelText(/jira email/i), { target: { value: 'a@co.net' } })
    fireEvent.change(screen.getByLabelText(/jira api token/i), { target: { value: 'ATATT3x' } })
    fireEvent.click(screen.getByLabelText(/save jira credentials/i))
    await waitFor(() => {
      expect(mockCredentialsSet).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'jira',
          domain: 'co.atlassian.net',
          email: 'a@co.net',
          apiToken: 'ATATT3x',
        })
      )
    })
  })

  it('shows Saved confirmation after successful Linear save', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    mockCredentialsSet.mockResolvedValue({ ok: true })
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => screen.getByLabelText(/linear api key/i))
    fireEvent.change(screen.getByLabelText(/linear api key/i), { target: { value: 'lin_abc' } })
    fireEvent.click(screen.getByLabelText(/save linear credentials/i))
    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeTruthy()
    })
  })

  // ─── Section 2: Autonomy & gates ───

  it('renders autonomy segmented control with Guided / Standard / Fast buttons', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /guided/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /standard/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /fast/i })).toBeTruthy()
    })
  })

  it('Standard autonomy button is pressed by default (DEFAULT_SETTINGS.defaultAutonomy = standard)', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      const standardBtn = screen.getByRole('button', { name: /standard/i })
      expect(standardBtn.getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('clicking Guided autonomy button updates aria-pressed', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => screen.getByRole('button', { name: /guided/i }))
    fireEvent.click(screen.getByRole('button', { name: /guided/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /guided/i }).getAttribute('aria-pressed')).toBe(
        'true'
      )
      expect(screen.getByRole('button', { name: /standard/i }).getAttribute('aria-pressed')).toBe(
        'false'
      )
    })
  })

  it('renders 10 phase gate rows', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      const rows = screen.getAllByRole('checkbox', { name: /required|auto-approve/i })
      expect(rows.length).toBeGreaterThanOrEqual(10)
    })
  })

  it('self-review gate row is disabled (always required)', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getAllByText(/always required/i).length).toBeGreaterThan(0)
      const selfReviewRequired = screen.getByRole('checkbox', {
        name: /self-review required/i,
      }) as HTMLInputElement
      expect(selfReviewRequired.disabled).toBe(true)
    })
  })

  it('open-pr gate row is disabled (always required)', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      const openPrRequired = screen.getByRole('checkbox', {
        name: /open pr required/i,
      }) as HTMLInputElement
      expect(openPrRequired.disabled).toBe(true)
    })
  })

  it('renders batch check-ins toggle', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText(/enable batch check-ins/i)).toBeTruthy()
    })
  })

  it('renders write-back toggle', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText(/write status back to tracker/i)).toBeTruthy()
    })
  })

  // ─── Section 3: Agent runner ───

  it('renders model selector with Claude model options', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      const select = screen.getByLabelText(/default model/i) as HTMLSelectElement
      expect(select).toBeTruthy()
      expect(select.tagName).toBe('SELECT')
      const options = Array.from(select.options).map((o) => o.value)
      expect(options).toContain('claude-opus-4-6')
      expect(options).toContain('claude-sonnet-4-6')
    })
  })

  it('renders run console position selector', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      const select = screen.getByLabelText(/run console position/i) as HTMLSelectElement
      expect(select).toBeTruthy()
      const options = Array.from(select.options).map((o) => o.value)
      expect(options).toContain('bottom')
      expect(options).toContain('side')
      expect(options).toContain('tab')
    })
  })

  it('renders disallowed paths textarea', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText(/disallowed paths/i)).toBeTruthy()
    })
  })

  it('renders Save settings button and shows confirmation after click', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => screen.getByLabelText(/save agent runner settings/i))
    fireEvent.click(screen.getByLabelText(/save agent runner settings/i))
    await waitFor(() => {
      expect(screen.getByText(/settings saved/i)).toBeTruthy()
    })
  })

  it('renders require clean git tree and create checkpoint toggles', async () => {
    const { SettingsView } = await import('../../src/components/SettingsView.js')
    render(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByLabelText(/require clean git tree/i)).toBeTruthy()
      expect(screen.getByLabelText(/create git checkpoint/i)).toBeTruthy()
    })
  })
})

// --- App sub-nav ---
describe('App sub-nav', () => {
  it('renders 4 sub-nav tab buttons', async () => {
    const { App } = await import('../../src/renderer/App.js')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tickets/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /features/i })).toBeTruthy()
    })
  })

  it('shows TicketsView by default (Tickets tab)', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    const { App } = await import('../../src/renderer/App.js')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/connect linear or jira/i)).toBeTruthy()
    })
  })

  it('switches to FeaturesView when Features tab is clicked', async () => {
    const { App } = await import('../../src/renderer/App.js')
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /features/i }))
    fireEvent.click(screen.getByRole('button', { name: /features/i }))
    await waitFor(() => {
      expect(screen.getByText(/no features/i)).toBeTruthy()
    })
  })

  it('shows Settings when gear/settings button is clicked', async () => {
    const { App } = await import('../../src/renderer/App.js')
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    await waitFor(() => {
      expect(screen.getByText(/ticket integrations/i)).toBeTruthy()
    })
  })
})
