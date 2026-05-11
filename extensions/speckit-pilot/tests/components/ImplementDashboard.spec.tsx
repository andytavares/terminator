import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// Mock window.electronAPI
const mockReadFile = vi.fn()

function setupElectronAPI() {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    fs: { readFile: mockReadFile },
  }
}

import { ImplementDashboard } from '../../src/components/ImplementDashboard.js'

describe('ImplementDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupElectronAPI()
    mockReadFile.mockResolvedValue({ error: 'not found' })
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('renders the running header', () => {
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    expect(screen.getByText(/Implement — running/)).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('renders control buttons', () => {
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    expect(screen.getByText('Pause after current task')).toBeTruthy()
    expect(screen.getByText('Stop')).toBeTruthy()
    expect(screen.getByText('Open tasks.md')).toBeTruthy()
  })

  it('calls onStop when Stop is clicked', async () => {
    const onStop = vi.fn().mockResolvedValue(undefined)
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={onStop}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Stop'))
    await waitFor(() => {
      expect(onStop).toHaveBeenCalledOnce()
    })
  })

  it('calls onPause when Pause is clicked', () => {
    const onPause = vi.fn()
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={onPause}
        onOpenTasks={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Pause after current task'))
    expect(onPause).toHaveBeenCalledOnce()
  })

  it('calls onOpenTasks when Open tasks.md is clicked', () => {
    const onOpenTasks = vi.fn()
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={onOpenTasks}
      />
    )
    fireEvent.click(screen.getByText('Open tasks.md'))
    expect(onOpenTasks).toHaveBeenCalledOnce()
  })

  it('loads tasks.md and parses task list', async () => {
    mockReadFile.mockResolvedValue({
      content: `
## Tasks

- [ ] T001 Scaffold project
- [x] T002 Add types
- [ ] T003 Wire IPC
      `.trim(),
    })
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('/repo/specs/001/tasks.md')
    })
    await waitFor(() => {
      expect(screen.getByText('T001')).toBeTruthy()
      expect(screen.getByText('T002')).toBeTruthy()
    })
  })

  it('shows Done badge for completed tasks', async () => {
    mockReadFile.mockResolvedValue({
      content: `- [x] T001 Scaffold project`,
    })
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    await waitFor(() => screen.getByText('Done'))
  })

  it('shows Queued badge for pending tasks', async () => {
    mockReadFile.mockResolvedValue({
      content: `- [ ] T001 Scaffold project`,
    })
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    await waitFor(() => screen.getByText('Queued'))
  })

  it('shows task table headers', async () => {
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    expect(screen.getByText('#')).toBeTruthy()
    expect(screen.getByText('TASK')).toBeTruthy()
    expect(screen.getByText('STATUS')).toBeTruthy()
  })

  it('shows elapsed time display', () => {
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    // Should show elapsed time in m:ss format
    expect(screen.getByText(/^\d+:\d{2}$/)).toBeTruthy()
  })

  it('collapses extra tasks into summary row', async () => {
    const tasks = Array.from(
      { length: 10 },
      (_, i) => `- [ ] T${String(i + 1).padStart(3, '0')} Task ${i + 1}`
    ).join('\n')
    mockReadFile.mockResolvedValue({ content: tasks })
    render(
      <ImplementDashboard
        featureDir="/repo/specs/001"
        onStop={vi.fn().mockResolvedValue(undefined)}
        onPause={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByText(/more/)).toBeTruthy()
    })
  })
})
