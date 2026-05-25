import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mockReadFile = vi.fn()

function setupElectronAPI() {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    fs: { readFile: mockReadFile },
  }
}

import { KanbanBoard } from '../../src/components/KanbanBoard.js'

const TASKS_MD = `
- [ ] T1 Set up project structure
- [x] T2 Write initial types
- [ ] T3 Implement parser
`

describe('KanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupElectronAPI()
    mockReadFile.mockResolvedValue({ content: TASKS_MD })
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('renders all four lane headers', async () => {
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      const titles = document.querySelectorAll('.sk-kanban__lane-title')
      const labels = Array.from(titles).map((el) => el.textContent)
      expect(labels).toContain('Todo')
      expect(labels).toContain('In Progress')
      expect(labels).toContain('In Review')
      expect(labels).toContain('Done')
    })
  })

  it('places queued tasks in Todo lane', async () => {
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText('Set up project structure')).toBeTruthy()
      expect(screen.getByText('Implement parser')).toBeTruthy()
    })
  })

  it('places completed tasks in Done lane', async () => {
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText('Write initial types')).toBeTruthy()
    })
  })

  it('shows task IDs', async () => {
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText('T1')).toBeTruthy()
      expect(screen.getByText('T2')).toBeTruthy()
    })
  })

  it('shows empty state when tasks.md is missing', async () => {
    mockReadFile.mockResolvedValue({ error: 'not found' })
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText('No tasks found')).toBeTruthy()
    })
  })

  it('reads tasks.md from the correct featureDir path', async () => {
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('/repo/specs/001/tasks.md')
    })
  })

  it('shows lane counts', async () => {
    render(<KanbanBoard featureDir="/repo/specs/001" />)
    await waitFor(() => {
      // Todo has T1 and T3
      const counts = screen.getAllByText('2')
      expect(counts.length).toBeGreaterThan(0)
    })
  })
})
