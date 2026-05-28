import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { RunConsole } from '../../../src/components/RunConsole.js'
import type { Run } from '../../../src/types/foundry.types.js'

const mockInvoke = vi.fn()
const mockOn = vi.fn(() => () => {})

function setupElectronAPI() {
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke, on: mockOn },
  }
}

function setRunId(runId: string, repoRoot = '/ws') {
  Object.defineProperty(window, 'location', {
    value: { search: `?runId=${runId}&repoRoot=${encodeURIComponent(repoRoot)}` },
    writable: true,
    configurable: true,
  })
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    mode: 'spec-to-code',
    providerId: 'claude',
    model: 'claude-sonnet-4-5',
    status: 'running',
    createdAt: new Date().toISOString(),
    workspaceRoot: '/ws',
    currentIteration: 1,
    iterationLimit: 3,
    iterations: [],
    fileChanges: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setupElectronAPI()
  setRunId('run-1')
  // Default: run-list returns a run, run-logs returns empty, git-diff returns empty
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'foundry:run-list') return Promise.resolve({ runs: [makeRun()] })
    if (channel === 'foundry:run-logs') return Promise.resolve({ entries: [] })
    if (channel === 'foundry:git-diff-file')
      return Promise.resolve({ unifiedDiff: '', linesAdded: 0, linesRemoved: 0 })
    return Promise.resolve({})
  })
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('RunConsole', () => {
  it('shows loading state initially', () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))
    render(<RunConsole repoRoot="/ws" />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows "Run not found" when run is missing', async () => {
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [] })
      return Promise.resolve({ entries: [] })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => expect(screen.getByText('Run not found.')).toBeTruthy())
  })

  it('shows "Running" status label', async () => {
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => expect(screen.getByText('Running')).toBeTruthy())
  })

  it('shows "Awaiting review" label for gate status', async () => {
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [makeRun({ status: 'gate' })] })
      return Promise.resolve({ entries: [], diff: '' })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => expect(screen.getByText('Awaiting review')).toBeTruthy())
  })

  it('shows gate controls when status is gate', async () => {
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [makeRun({ status: 'gate' })] })
      return Promise.resolve({ entries: [], diff: '' })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => {
      expect(screen.getByText('✓ Approve')).toBeTruthy()
      expect(screen.getByText('✎ Request Changes')).toBeTruthy()
      expect(screen.getByText('× Reject & Reset')).toBeTruthy()
    })
  })

  it('does not show gate controls when status is running', async () => {
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => expect(screen.queryByText('✓ Approve')).toBeNull())
  })

  it('shows Abort button when run is active', async () => {
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => expect(screen.getByText('Abort')).toBeTruthy())
  })

  it('hides Abort button when run is terminal', async () => {
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [makeRun({ status: 'done' })] })
      return Promise.resolve({ entries: [] })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => expect(screen.queryByText('Abort')).toBeNull())
  })

  it('shows agent output and changed files sections', async () => {
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => {
      expect(screen.getByText('Agent output')).toBeTruthy()
      expect(screen.getByText('Changed files (0)')).toBeTruthy()
    })
  })

  it('shows file in changed files list', async () => {
    const run = makeRun({
      fileChanges: [
        {
          filePath: '/ws/src/foo.ts',
          status: 'new',
          linesAdded: 10,
          linesRemoved: 0,
          unifiedDiff: '',
        },
      ],
    })
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [run] })
      return Promise.resolve({ entries: [], diff: '' })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => {
      expect(screen.getByText('foo.ts')).toBeTruthy()
      expect(screen.getByText('Changed files (1)')).toBeTruthy()
    })
  })

  it('calls foundry:run-gate-decide with approve on Approve click', async () => {
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [makeRun({ status: 'gate' })] })
      return Promise.resolve({ entries: [], diff: '', ok: true })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => screen.getByText('✓ Approve'))
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => {
      const call = mockInvoke.mock.calls.find(([ch]) => ch === 'foundry:run-gate-decide')
      expect(call?.[1]).toMatchObject({ decision: 'approve', runId: 'run-1' })
    })
  })

  it('calls foundry:run-abort on Abort click', async () => {
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => screen.getByText('Abort'))
    fireEvent.click(screen.getByText('Abort'))
    await waitFor(() => {
      expect(mockInvoke.mock.calls.some(([ch]) => ch === 'foundry:run-abort')).toBe(true)
    })
  })

  it('fetches diff when a file is clicked', async () => {
    const run = makeRun({
      status: 'gate',
      fileChanges: [
        {
          filePath: '/ws/src/foo.ts',
          status: 'modified',
          linesAdded: 2,
          linesRemoved: 1,
          unifiedDiff: '',
        },
      ],
    })
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [run] })
      if (ch === 'foundry:git-diff-file')
        return Promise.resolve({
          unifiedDiff: '+new line\n-old line',
          linesAdded: 1,
          linesRemoved: 1,
        })
      return Promise.resolve({ entries: [] })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => screen.getByText('foo.ts'))
    fireEvent.click(screen.getByText('foo.ts'))
    await waitFor(() => {
      expect(mockInvoke.mock.calls.some(([ch]) => ch === 'foundry:git-diff-file')).toBe(true)
    })
  })

  it('Request Changes is disabled without a note', async () => {
    mockInvoke.mockImplementation((ch: string) => {
      if (ch === 'foundry:run-list') return Promise.resolve({ runs: [makeRun({ status: 'gate' })] })
      return Promise.resolve({ entries: [], diff: '' })
    })
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => screen.getByText('✎ Request Changes'))
    const btn = screen.getByText('✎ Request Changes') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('registers listeners for run-status-changed and run-log events', async () => {
    render(<RunConsole repoRoot="/ws" />)
    await waitFor(() => screen.getByText('Running'))
    const channels = mockOn.mock.calls.map(([ch]) => ch)
    expect(channels).toContain('foundry:run-status-changed')
    expect(channels).toContain('foundry:run-log')
  })
})
