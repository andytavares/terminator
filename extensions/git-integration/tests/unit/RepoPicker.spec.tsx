import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { RepoPicker } from '../../src/components/pr-review/RepoPicker'

const DAY = 86400000
const repos = [
  {
    fullName: 'acme/api',
    owner: 'acme',
    private: true,
    pushedAt: new Date(Date.now() - 3 * DAY).toISOString(),
  },
  {
    fullName: 'acme/web',
    owner: 'acme',
    private: false,
    pushedAt: new Date(Date.now() - 40 * DAY).toISOString(),
  },
  {
    fullName: 'octo/cli',
    owner: 'octo',
    private: false,
    pushedAt: new Date(Date.now() - 1 * DAY).toISOString(),
  },
]

function setup(listResult: unknown = { repos }) {
  const invoke = vi.fn((channel: string) => {
    if (channel === 'github:accessible-repos') return Promise.resolve(listResult)
    return Promise.resolve({ ok: true })
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => () => {}) },
  }
  const onSaved = vi.fn()
  const onClose = vi.fn()
  return { invoke, onSaved, onClose }
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

beforeEach(() => vi.clearAllMocks())

describe('RepoPicker', () => {
  it('shows a loading state then the repositories grouped by owner', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    expect(screen.getByText('Reading your repositories…')).toBeTruthy()
    await screen.findByText('acme/api')
    expect(screen.getByRole('group', { name: 'acme' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'octo' })).toBeTruthy()
    expect(screen.getByText('private')).toBeTruthy()
    expect(screen.getByText('pushed 3 days ago')).toBeTruthy()
    expect(screen.getByText('All repositories (nothing selected)')).toBeTruthy()
  })

  it('filters by name with the search box', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cli' } })
    expect(screen.queryByText('acme/api')).toBeNull()
    expect(screen.getByText('octo/cli')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText('No repositories match')).toBeTruthy()
  })

  it('group checkbox selects the whole group and is indeterminate when partial', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    const group = box('Select every repository of acme')
    fireEvent.click(box('acme/api'))
    expect(group.indeterminate).toBe(true)
    expect(within(screen.getByRole('group', { name: 'acme' })).getByText('1 of 2')).toBeTruthy()
    fireEvent.click(group)
    expect(box('acme/web').checked).toBe(true)
    expect(group.indeterminate).toBe(false)
    expect(group.checked).toBe(true)
    expect(box('octo/cli').checked).toBe(false)
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    fireEvent.click(group)
    expect(box('acme/api').checked).toBe(false)
  })

  it('Select all shown only takes the filtered rows, Clear empties', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('All repositories (nothing selected)')).toBeTruthy()
  })

  it('Save sends the exact selection then calls onSaved', async () => {
    const s = setup()
    render(<RepoPicker initial={['octo/cli']} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    fireEvent.click(box('acme/web'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s.onSaved).toHaveBeenCalled())
    expect(s.invoke).toHaveBeenCalledWith('github:review-repos-set', {
      repos: ['octo/cli', 'acme/web'],
    })
  })

  it('sends an empty selection as []', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s.onSaved).toHaveBeenCalled())
    expect(s.invoke).toHaveBeenCalledWith('github:review-repos-set', { repos: [] })
  })

  it('Refresh list asks for a fresh list', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    await waitFor(() =>
      expect(s.invoke).toHaveBeenCalledWith('github:accessible-repos', { refresh: true })
    )
  })

  it('shows the error with Retry that reloads', async () => {
    const s = setup({ error: 'gh: not logged in' })
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    expect(await screen.findByText('gh: not logged in')).toBeTruthy()
    s.invoke.mockImplementation(() => Promise.resolve({ repos }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('acme/api')
  })

  it('focuses the search box once loaded and Cancel closes', async () => {
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(s.onClose).toHaveBeenCalled()
  })
})
