import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke, on: vi.fn(() => () => {}) } },
  writable: true,
  configurable: true,
})

import { ArchiveView } from '../../src/components/ArchiveView'

const ARCHIVE = {
  tasks: [],
  projects: [
    {
      id: 'p1',
      name: 'Old launch',
      filePath: '/vault/projects/old-launch.md',
      status: 'completed',
      isStale: false,
      nextActionCount: 0,
      lastModified: '2026-09-01T00:00:00Z',
      terminatorLinks: [],
    },
  ],
  areas: [],
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue(ARCHIVE)
})

afterEach(() => cleanup())

describe('ArchiveView sections', () => {
  it('names each section with its count and opens on completed tasks', async () => {
    render(<ArchiveView />)
    const tasks = await screen.findByRole('tab', { name: 'Completed tasks, 0' })
    expect(tasks.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Archived projects, 1' })).toBeTruthy()
  })

  it('moves to the next section with the arrow keys and shows its panel', async () => {
    render(<ArchiveView />)
    const tasks = await screen.findByRole('tab', { name: 'Completed tasks, 0' })
    fireEvent.keyDown(tasks, { key: 'ArrowRight' })
    expect(
      screen.getByRole('tab', { name: 'Archived projects, 1' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('Old launch')
  })

  it('reads the window it shows as one choice and reloads for another', async () => {
    render(<ArchiveView />)
    await screen.findByRole('tab', { name: 'Completed tasks, 0' })
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }))
    expect(await screen.findByRole('radio', { name: '90 days', checked: true })).toBeTruthy()
    expect(mockInvoke).toHaveBeenLastCalledWith('task-vault:vault:list-archive', { days: 90 })
  })
})
