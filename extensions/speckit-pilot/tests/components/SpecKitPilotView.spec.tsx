import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// Must mock before importing the component
const mockFeatureList = vi.fn()
const mockCheckArtifacts = vi.fn()
const mockFileWrite = vi.fn()
const mockPilotState = vi.fn()
const mockPhaseApprove = vi.fn()
const mockPhaseReject = vi.fn()
const mockPhaseRevoke = vi.fn()
const mockPhaseSkip = vi.fn()
const mockPhaseUnskip = vi.fn()
const mockHistoryLoad = vi.fn()
const mockArtifactRead = vi.fn()
const mockImplementStop = vi.fn()
const mockSessionList = vi.fn()
const mockOnStateChanged = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    featureList: mockFeatureList,
    checkArtifacts: mockCheckArtifacts,
    fileWrite: mockFileWrite,
    pilotState: mockPilotState,
    phaseApprove: mockPhaseApprove,
    phaseReject: mockPhaseReject,
    phaseRevoke: mockPhaseRevoke,
    phaseSkip: mockPhaseSkip,
    phaseUnskip: mockPhaseUnskip,
    historyLoad: mockHistoryLoad,
    artifactRead: mockArtifactRead,
    implementStop: mockImplementStop,
    sessionList: mockSessionList,
    onStateChanged: mockOnStateChanged,
  }),
}))

import { SpecKitPilotView } from '../../src/components/SpecKitPilotView.js'
import type { PilotState } from '../../src/types/speckit.types.js'

const mockReadFile = vi.fn()
const mockOpenPath = vi.fn()

const mockTerminalInput = vi.fn()

function setupElectronAPI() {
  // Add electronAPI to the existing jsdom window — do NOT replace window, as that
  // breaks React's DOM helpers (Selection instanceof checks, etc.)
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    fs: { readFile: mockReadFile },
    shell: { openPath: mockOpenPath },
    terminal: { input: mockTerminalInput },
  }
}

function makePilotState(overrides?: Partial<PilotState>): PilotState {
  return {
    version: 1,
    featureDir: '/repo/specs/001',
    settings: { commandTimeoutMs: 120000, maxFilesPerImplementRun: 5 },
    phases: {
      constitution: { status: 'locked', artifactPaths: [], hashes: {} },
      specify: { status: 'locked', artifactPaths: [], hashes: {} },
      clarify: { status: 'locked', artifactPaths: [], hashes: {} },
      plan: { status: 'locked', artifactPaths: [], hashes: {} },
      checklist: { status: 'locked', artifactPaths: [], hashes: {} },
      tasks: { status: 'locked', artifactPaths: [], hashes: {} },
      analyze: { status: 'locked', artifactPaths: [], hashes: {} },
      implement: { status: 'locked', artifactPaths: [], hashes: {} },
    },
    ...overrides,
  }
}

describe('SpecKitPilotView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupElectronAPI()
    mockOnStateChanged.mockReturnValue(vi.fn()) // return unsub fn
    mockFeatureList.mockResolvedValue({ features: [] })
    mockCheckArtifacts.mockResolvedValue({ exists: {} })
    mockPilotState.mockResolvedValue({ notFound: true })
    mockHistoryLoad.mockResolvedValue({ entries: [] })
    mockArtifactRead.mockResolvedValue({ current: null, approved: null })
    mockImplementStop.mockResolvedValue({ ok: true })
    mockSessionList.mockResolvedValue({ sessions: [] })
    mockPhaseSkip.mockResolvedValue({ state: makePilotState() })
    mockPhaseUnskip.mockResolvedValue({ state: makePilotState() })
    mockReadFile.mockResolvedValue({ error: 'not found' })
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('shows empty state when repoRoot is null', () => {
    render(<SpecKitPilotView repoRoot={null} />)
    expect(screen.getByText('No workspace open')).toBeTruthy()
  })

  it('shows loading then empty features state', async () => {
    mockFeatureList.mockResolvedValue({ features: [] })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => {
      expect(screen.getByText('No features found')).toBeTruthy()
    })
  })

  it('shows a prompt to run speckit-specify when no features', async () => {
    mockFeatureList.mockResolvedValue({ features: [] })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/speckit-specify/)).toBeTruthy()
    })
  })

  it('shows feature selector with multiple features', async () => {
    mockFeatureList.mockResolvedValue({
      features: [
        { name: 'Feature A', dir: '/repo/specs/001' },
        { name: 'Feature B', dir: '/repo/specs/002' },
      ],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => {
      expect(screen.getByText('Feature A')).toBeTruthy()
      expect(screen.getByText('Feature B')).toBeTruthy()
    })
  })

  it('auto-selects single feature and loads phase list', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockPilotState.mockResolvedValue({ notFound: true })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => {
      expect(screen.getByText('Constitution')).toBeTruthy()
      expect(screen.getByText('Specify')).toBeTruthy()
    })
  })

  it('shows error message when featureList throws', async () => {
    mockFeatureList.mockRejectedValue(new Error('network error'))
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/network error/)).toBeTruthy()
    })
  })

  it('shows right-panel placeholder when no phase is selected', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => {
      expect(screen.getByText('Select a phase')).toBeTruthy()
    })
  })

  it('shows phase detail when a phase row is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    expect(
      screen.getByText('Captures what users need and why — the feature specification.')
    ).toBeTruthy()
  })

  it('shows locked reason when artifact does not exist', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: false } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      // 'locked' status shows upstream-not-approved reason
      expect(screen.getByText('Upstream not approved')).toBeTruthy()
      expect(screen.getByText(/speckit-specify/)).toBeTruthy()
    })
  })

  it('shows Approve button for awaiting_review phases', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: { status: 'awaiting_review', artifactPaths: [], hashes: {} },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('Approve & continue')).toBeTruthy()
    })
  })

  it('shows Revoke approval button for approved phase', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: {
            status: 'approved',
            artifactPaths: [],
            hashes: {},
            approvedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('Revoke approval')).toBeTruthy()
    })
  })

  it('calls phaseApprove when Approve & continue is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: { status: 'awaiting_review', artifactPaths: [], hashes: {} },
        },
      }),
    })
    mockPhaseApprove.mockResolvedValue({ state: makePilotState() })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getAllByText('Approve & continue'))
    fireEvent.click(screen.getAllByText('Approve & continue')[0])
    await waitFor(() => {
      expect(mockPhaseApprove).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'specify',
        note: undefined,
      })
    })
  })

  it('calls phaseRevoke when Revoke approval is confirmed', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: { status: 'approved', artifactPaths: [], hashes: {} },
        },
      }),
    })
    mockPhaseRevoke.mockResolvedValue({ state: makePilotState() })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    // First click shows the confirm form
    await waitFor(() => screen.getByText('Revoke approval'))
    fireEvent.click(screen.getByText('Revoke approval'))
    // Now confirm in the dialog — the button appears again in the confirm form
    await waitFor(() => {
      const revokeButtons = screen.getAllByText('Revoke approval')
      // click the confirm button (the danger one in the form)
      fireEvent.click(revokeButtons[revokeButtons.length - 1])
    })
    await waitFor(() => {
      expect(mockPhaseRevoke).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'specify',
        note: undefined,
      })
    })
  })

  it('loads and displays file content for a phase with an artifact', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockReadFile.mockResolvedValue({ content: '# My Spec\nSome content' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('/repo/specs/001/spec.md')
    })
  })

  it('shows "File not found" when readFile returns no content', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockReadFile.mockResolvedValue({ error: 'not found' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeTruthy()
    })
  })

  it('shows checklist placeholder for checklist phase', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { checklist: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    // Click the phase row in the left panel (first occurrence of "Checklists")
    await waitFor(() => screen.getAllByText('Checklists'))
    fireEvent.click(screen.getAllByText('Checklists')[0])
    await waitFor(() => {
      expect(screen.getByText(/Checklist files are stored in/)).toBeTruthy()
    })
  })

  it('deselects phase when same phase is clicked again', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    // Click the phase row (left panel) — use first occurrence
    await waitFor(() => screen.getAllByText('Specify'))
    fireEvent.click(screen.getAllByText('Specify')[0])
    await waitFor(() =>
      expect(
        screen.getByText('Captures what users need and why — the feature specification.')
      ).toBeTruthy()
    )
    // Click the left-panel row again to deselect
    fireEvent.click(screen.getAllByText('Specify')[0])
    await waitFor(() => {
      expect(screen.getByText('Select a phase')).toBeTruthy()
    })
  })

  it('updates state when onStateChanged fires', async () => {
    let capturedHandler: ((data: unknown) => void) | null = null
    mockOnStateChanged.mockImplementation((handler) => {
      capturedHandler = handler
      return vi.fn()
    })
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))

    // Fire state change event with approved state
    await act(async () => {
      capturedHandler?.({
        state: makePilotState({
          phases: {
            ...makePilotState().phases,
            specify: { status: 'approved', artifactPaths: [], hashes: {} },
          },
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Revoke approval')).toBeTruthy()
    })
  })

  it('refreshes feature list on refresh button click', async () => {
    mockFeatureList.mockResolvedValue({ features: [] })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByTitle('Refresh'))
    fireEvent.click(screen.getByTitle('Refresh'))
    await waitFor(() => {
      expect(mockFeatureList).toHaveBeenCalledTimes(2)
    })
  })

  it('shows Open in editor button when a file is loaded', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('Open in editor')).toBeTruthy()
    })
  })

  it('calls shell.openPath when Open in editor is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    mockOpenPath.mockResolvedValue(undefined)
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Open in editor'))
    fireEvent.click(screen.getByText('Open in editor'))
    await waitFor(() => {
      expect(mockOpenPath).toHaveBeenCalledWith('/repo/specs/001/spec.md')
    })
  })

  it('switches to edit mode when Edit tab is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('shows save bar with unsaved changes indicator', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '# Changed' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('saves file and returns to preview on Save click', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    mockFileWrite.mockResolvedValue({ ok: true })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '# Updated' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(mockFileWrite).toHaveBeenCalledWith({
        filePath: '/repo/specs/001/spec.md',
        content: '# Updated',
      })
    })
  })

  it('shows save error when fileWrite returns an error', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    mockFileWrite.mockResolvedValue({ error: 'disk full' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '# Updated' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(screen.getByText('disk full')).toBeTruthy()
    })
  })

  it('cancels edit and returns to preview', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Content' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull()
    })
  })

  it('changes selected feature when dropdown changes', async () => {
    mockFeatureList.mockResolvedValue({
      features: [
        { name: 'Feature A', dir: '/repo/specs/001' },
        { name: 'Feature B', dir: '/repo/specs/002' },
      ],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Feature A'))
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '/repo/specs/002' } })
    await waitFor(() => {
      expect(mockPilotState).toHaveBeenCalledWith({ featureDir: '/repo/specs/002' })
    })
  })

  it('loads constitution file from repo root', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ content: '# Constitution' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Constitution'))
    fireEvent.click(screen.getByText('Constitution'))
    await waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('/repo/.specify/memory/constitution.md')
    })
  })

  it('shows Skipped status when state is approved but artifact file is missing', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    // No artifact on disk for specify
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: false } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: {
            status: 'approved',
            artifactPaths: [],
            hashes: {},
            approvedAt: '2026-01-01T00:00:00Z',
          },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0)
      expect(screen.getByText('Never run')).toBeTruthy()
    })
  })

  it('shows Skipped status when state is stale but artifact file is missing', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: false } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: { status: 'stale', artifactPaths: [], hashes: {} },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0)
    })
  })

  it('unsubscribes from onStateChanged on unmount', async () => {
    const unsub = vi.fn()
    mockOnStateChanged.mockReturnValue(unsub)
    mockFeatureList.mockResolvedValue({ features: [] })
    const { unmount } = render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('No features found'))
    unmount()
    expect(unsub).toHaveBeenCalled()
  })

  // ── Close tabs ──────────────────────────────────────────────────────────

  it('closes the detail tab when × is clicked, returning to placeholder', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByLabelText('Close tab'))
    fireEvent.click(screen.getByLabelText('Close tab'))
    await waitFor(() => {
      expect(screen.getByText('Select a phase')).toBeTruthy()
    })
  })

  it('closes the diff tab returning to detail view', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: {
            status: 'approved',
            artifactPaths: [],
            hashes: {},
            approvedAt: '2026-01-01T00:00:00Z',
          },
        },
      }),
    })
    mockReadFile.mockResolvedValue({ content: '# Spec' })
    mockArtifactRead.mockResolvedValue({ current: '# Spec', approved: '# Old' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    // Trigger diff load via "Open artifact diff" button in ApprovalPanel
    await waitFor(() => screen.getByText('Open artifact diff'))
    fireEvent.click(screen.getByText('Open artifact diff'))
    // Diff tab appears once content is loaded
    await waitFor(() => screen.getByLabelText('Close diff tab'))
    fireEvent.click(screen.getByLabelText('Close diff tab'))
    await waitFor(() => {
      expect(screen.queryByText('spec.md (diff)')).toBeNull()
      expect(screen.getByText(/Specify — approved/)).toBeTruthy()
    })
  })

  // ── Run in terminal ──────────────────────────────────────────────────────

  it('shows Run in terminal button for ready phases', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('▶ Run in terminal')).toBeTruthy()
    })
  })

  it('opens run dialog when Run in terminal is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockSessionList.mockResolvedValue({ sessions: [] })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('▶ Run in terminal'))
    fireEvent.click(screen.getByText('▶ Run in terminal'))
    await waitFor(() => {
      // Dialog title
      expect(screen.getByText('Run in terminal')).toBeTruthy()
      // Command shown in dialog (multiple occurrences are ok — at least one visible)
      expect(screen.getAllByText('/speckit-specify').length).toBeGreaterThan(0)
    })
  })

  it('shows session picker when sessions are available', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockSessionList.mockResolvedValue({
      sessions: [{ id: 'sess-1', name: 'Claude Session 1' }],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('▶ Run in terminal'))
    fireEvent.click(screen.getByText('▶ Run in terminal'))
    await waitFor(() => {
      expect(screen.getByText('Claude Session 1')).toBeTruthy()
      expect(screen.getByText('Send command')).toBeTruthy()
    })
  })

  it('sends command to selected session', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockSessionList.mockResolvedValue({
      sessions: [{ id: 'sess-1', name: 'Claude Session 1' }],
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('▶ Run in terminal'))
    fireEvent.click(screen.getByText('▶ Run in terminal'))
    await waitFor(() => screen.getByText('Claude Session 1'))
    // Pick the last combobox — first one is the feature dropdown, second is the session picker
    const combos = screen.getAllByRole('combobox')
    fireEvent.change(combos[combos.length - 1], { target: { value: 'sess-1' } })
    fireEvent.click(screen.getByText('Send command'))
    await waitFor(() => {
      expect(mockTerminalInput).toHaveBeenCalledWith('sess-1', '/speckit-specify\r')
    })
  })

  it('shows copy fallback when no sessions available', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockSessionList.mockResolvedValue({ sessions: [] })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('▶ Run in terminal'))
    fireEvent.click(screen.getByText('▶ Run in terminal'))
    await waitFor(() => {
      expect(screen.getByText(/No active terminal sessions found/)).toBeTruthy()
      expect(screen.getByText('Copy')).toBeTruthy()
    })
  })

  it('closes run dialog when Close is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockSessionList.mockResolvedValue({ sessions: [] })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('▶ Run in terminal'))
    fireEvent.click(screen.getByText('▶ Run in terminal'))
    await waitFor(() => screen.getByText('Close'))
    fireEvent.click(screen.getByText('Close'))
    await waitFor(() => {
      expect(screen.queryByText('Run in terminal')).toBeFalsy()
    })
  })

  // ── Approve from ready/stale state ──────────────────────────────────────

  it('shows Approve button for ready phase when artifact file exists', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockReadFile.mockResolvedValue({ content: '# Spec content' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeTruthy()
    })
  })

  it('calls phaseApprove when Approve is clicked from ready state', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockReadFile.mockResolvedValue({ content: '# Spec content' })
    mockPhaseApprove.mockResolvedValue({ state: makePilotState() })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() => {
      expect(mockPhaseApprove).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'specify',
        note: undefined,
      })
    })
  })

  it('does not show Approve button for ready phase when artifact file is missing', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockReadFile.mockResolvedValue({ error: 'not found' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('▶ Run in terminal'))
    expect(screen.queryByText('Approve')).toBeNull()
  })

  // ── Skip / Unskip ───────────────────────────────────────────────────────

  it('shows Skip phase button for ready phases', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { clarify: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Clarify'))
    fireEvent.click(screen.getByText('Clarify'))
    await waitFor(() => {
      expect(screen.getByText('Skip phase')).toBeTruthy()
    })
  })

  it('calls phaseSkip when Skip phase is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { clarify: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Clarify'))
    fireEvent.click(screen.getByText('Clarify'))
    await waitFor(() => screen.getByText('Skip phase'))
    fireEvent.click(screen.getByText('Skip phase'))
    await waitFor(() => {
      expect(mockPhaseSkip).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'clarify',
      })
    })
  })

  it('shows Unskip phase button for skipped phases', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { clarify: false } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          clarify: { status: 'skipped', artifactPaths: [], hashes: {} },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Clarify'))
    fireEvent.click(screen.getByText('Clarify'))
    await waitFor(() => {
      expect(screen.getByText('Unskip phase')).toBeTruthy()
    })
  })

  it('calls phaseUnskip when Unskip phase is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { clarify: false } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          clarify: { status: 'skipped', artifactPaths: [], hashes: {} },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Clarify'))
    fireEvent.click(screen.getByText('Clarify'))
    await waitFor(() => screen.getByText('Unskip phase'))
    fireEvent.click(screen.getByText('Unskip phase'))
    await waitFor(() => {
      expect(mockPhaseUnskip).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'clarify',
      })
    })
  })

  it('does not show Run in terminal for skipped phases', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { clarify: false } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          clarify: { status: 'skipped', artifactPaths: [], hashes: {} },
        },
      }),
    })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Clarify'))
    fireEvent.click(screen.getByText('Clarify'))
    await waitFor(() => screen.getByText('Unskip phase'))
    expect(screen.queryByText('▶ Run in terminal')).toBeNull()
  })

  // ── File preview when approved ────────────────────────────────────────────

  it('shows file content below approval panel when phase is approved', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPilotState.mockResolvedValue({
      state: makePilotState({
        phases: {
          ...makePilotState().phases,
          specify: {
            status: 'approved',
            artifactPaths: [],
            hashes: {},
            approvedAt: '2026-01-01T00:00:00Z',
          },
        },
      }),
    })
    mockReadFile.mockResolvedValue({ content: '# My Spec' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      // Approval panel is shown
      expect(screen.getByText('Revoke approval')).toBeTruthy()
    })
    await waitFor(() => {
      // File preview section rendered — the artifact-preview__filename span has the path
      expect(screen.getAllByText('spec.md').length).toBeGreaterThan(0)
    })
  })
})

describe('FileEditor (via SpecKitPilotView)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupElectronAPI()
    mockOnStateChanged.mockReturnValue(vi.fn())
    mockCheckArtifacts.mockResolvedValue({ exists: {} })
    mockPilotState.mockResolvedValue({ notFound: true })
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('shows "No artifact file for this phase" when filePath is null (plan phase, no feature selected)', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockReadFile.mockResolvedValue({ error: 'not found' })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Plan'))
    fireEvent.click(screen.getByText('Plan'))
    // Since file doesn't exist, shows "File not found"
    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeTruthy()
    })
  })
})
