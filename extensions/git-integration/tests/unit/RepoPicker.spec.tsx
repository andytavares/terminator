import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  Object.assign(window, {
    electronAPI: {
      extensionBridge: { invoke, on: vi.fn(() => () => {}) },
    },
  })
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
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    await user.type(await screen.findByRole('searchbox'), 'cli')
    expect(screen.queryByText('acme/api')).toBeNull()
    expect(screen.getByText('octo/cli')).toBeTruthy()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('No repositories match')).toBeTruthy()
  })
})

describe('RepoPicker — group checkbox selects the whole group and is indeterminate when partial', () => {
  it('group checkbox selects the whole group and is indeterminate when partial', async () => {
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    const group = box('Select every repository of acme')
    await user.click(box('acme/api'))
    expect(group.indeterminate).toBe(true)
    expect(within(screen.getByRole('group', { name: 'acme' })).getByText('1 of 2')).toBeTruthy()
    await user.click(group)
    expect(box('acme/web').checked).toBe(true)
    expect(group.indeterminate).toBe(false)
    expect(group.checked).toBe(true)
    expect(box('octo/cli').checked).toBe(false)
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    await user.click(group)
    expect(box('acme/api').checked).toBe(false)
  })
})

describe('RepoPicker — Select all shown only takes the filtered rows, Clear empties', () => {
  it('Select all shown only takes the filtered rows, Clear empties', async () => {
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    await user.type(await screen.findByRole('searchbox'), 'acme')
    await user.click(await screen.findByRole('button', { name: 'Select all shown' }))
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('All repositories (nothing selected)')).toBeTruthy()
  })

  it('Save sends the exact selection then calls onSaved', async () => {
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={['octo/cli']} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    await user.click(box('acme/web'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s.onSaved).toHaveBeenCalled())
    expect(s.invoke).toHaveBeenCalledWith('github:review-repos-set', {
      repos: ['octo/cli', 'acme/web'],
    })
  })
})

describe('RepoPicker — sends an empty selection as []', () => {
  it('sends an empty selection as []', async () => {
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s.onSaved).toHaveBeenCalled())
    expect(s.invoke).toHaveBeenCalledWith('github:review-repos-set', { repos: [] })
  })

  it('Refresh list asks for a fresh list', async () => {
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    await user.click(await screen.findByRole('button', { name: 'Refresh list' }))
    await waitFor(() =>
      expect(s.invoke).toHaveBeenCalledWith('github:accessible-repos', { refresh: true })
    )
  })
})

describe('RepoPicker — shows the error with Retry that reloads', () => {
  it('shows the error with Retry that reloads', async () => {
    const user = userEvent.setup()
    const s = setup({ error: 'gh: not logged in' })
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    expect(await screen.findByText('gh: not logged in')).toBeTruthy()
    s.invoke.mockImplementation(() => Promise.resolve({ repos }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('acme/api')
  })

  it('focuses the search box once loaded and Cancel closes', async () => {
    const user = userEvent.setup()
    const s = setup()
    render(<RepoPicker initial={[]} onClose={s.onClose} onSaved={s.onSaved} />)
    await screen.findByText('acme/api')
    await waitFor(() => expect(screen.getByRole('searchbox').matches(':focus')).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(s.onClose).toHaveBeenCalled()
  })
})
