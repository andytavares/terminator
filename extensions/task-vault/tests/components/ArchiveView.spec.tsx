import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockInvoke = vi.fn()

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
  mockInvoke.mockResolvedValue(ARCHIVE)
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke: mockInvoke, on: () => () => {} },
    usage: { record: vi.fn() },
  })
})

afterEach(() => cleanup())

describe('ArchiveView heading', () => {
  it('is headed Archive, the name the sidebar gives it', async () => {
    render(<ArchiveView />)
    expect(await screen.findByRole('heading', { name: 'Archive' })).toBeTruthy()
  })
})

describe('ArchiveView sections', () => {
  it('names each section with its count and opens on completed tasks', async () => {
    render(<ArchiveView />)
    const tasks = await screen.findByRole('tab', { name: 'Completed tasks, 0' })
    expect(tasks.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Archived projects, 1' })).toBeTruthy()
  })

  it('moves to the next section with the arrow keys and shows its panel', async () => {
    const user = userEvent.setup()
    render(<ArchiveView />)
    const tasks = await screen.findByRole('tab', { name: 'Completed tasks, 0' })
    await user.click(tasks)
    expect(tasks.matches(':focus')).toBe(true)
    await user.keyboard('{ArrowRight}')
    expect(
      screen.getByRole('tab', { name: 'Archived projects, 1' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('Old launch')
  })

  it('reads the window it shows as one choice and reloads for another', async () => {
    const user = userEvent.setup()
    render(<ArchiveView />)
    await screen.findByRole('tab', { name: 'Completed tasks, 0' })
    await user.click(await screen.findByRole('radio', { name: '90 days' }))
    expect(await screen.findByRole('radio', { name: '90 days', checked: true })).toBeTruthy()
    expect(mockInvoke).toHaveBeenLastCalledWith('task-vault:vault:list-archive', { days: 90 })
  })
})
