import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// Must mock before importing the component
const mockFeatureList = vi.fn()
const mockCheckArtifacts = vi.fn()
const mockFileWrite = vi.fn()
const mockPilotState = vi.fn()
const mockPhaseApprove = vi.fn()
const mockPhaseRevoke = vi.fn()
const mockOnStateChanged = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    featureList: mockFeatureList,
    checkArtifacts: mockCheckArtifacts,
    fileWrite: mockFileWrite,
    pilotState: mockPilotState,
    phaseApprove: mockPhaseApprove,
    phaseRevoke: mockPhaseRevoke,
    onStateChanged: mockOnStateChanged,
  }),
}))

import { SpecKitPilotView } from '../../src/components/SpecKitPilotView.js'
import type { PilotState } from '../../src/types/speckit.types.js'

const mockReadFile = vi.fn()
const mockOpenPath = vi.fn()

function setupElectronAPI() {
  // Add electronAPI to the existing jsdom window — do NOT replace window, as that
  // breaks React's DOM helpers (Selection instanceof checks, etc.)
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    fs: { readFile: mockReadFile },
    shell: { openPath: mockOpenPath },
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
      expect(screen.getByText('Artifact not found')).toBeTruthy()
      expect(screen.getByText(/speckit-specify/)).toBeTruthy()
    })
  })

  it('shows Mark approved button for non-locked, non-approved phases', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => {
      expect(screen.getByText('Mark approved')).toBeTruthy()
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

  it('calls phaseApprove when Mark approved is clicked', async () => {
    mockFeatureList.mockResolvedValue({
      features: [{ name: 'My Feature', dir: '/repo/specs/001' }],
    })
    mockCheckArtifacts.mockResolvedValue({ exists: { specify: true } })
    mockPhaseApprove.mockResolvedValue({ state: makePilotState() })
    render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('Specify'))
    fireEvent.click(screen.getByText('Specify'))
    await waitFor(() => screen.getByText('Mark approved'))
    fireEvent.click(screen.getByText('Mark approved'))
    await waitFor(() => {
      expect(mockPhaseApprove).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'specify',
      })
    })
  })

  it('calls phaseRevoke when Revoke approval is clicked', async () => {
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
    await waitFor(() => screen.getByText('Revoke approval'))
    fireEvent.click(screen.getByText('Revoke approval'))
    await waitFor(() => {
      expect(mockPhaseRevoke).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'specify',
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
    await waitFor(() => screen.getByText('Mark approved'))

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

  it('unsubscribes from onStateChanged on unmount', async () => {
    const unsub = vi.fn()
    mockOnStateChanged.mockReturnValue(unsub)
    mockFeatureList.mockResolvedValue({ features: [] })
    const { unmount } = render(<SpecKitPilotView repoRoot="/repo" />)
    await waitFor(() => screen.getByText('No features found'))
    unmount()
    expect(unsub).toHaveBeenCalled()
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
