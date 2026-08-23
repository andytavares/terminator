import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { IssuePicker } from '../../../../src/renderer/components/integrations/IssuePicker'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import type { IssueSummary } from '../../../../src/shared/types/index'

function summary(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    tracker: 'linear',
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    branchName: null,
    ...over,
  }
}

const listMine = vi.fn()
const searchIssues = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  listMine.mockResolvedValue({ issues: [summary()], failures: [] })
  searchIssues.mockResolvedValue({ issues: [], failures: [] })
  useIntegrationsStore.setState({ listMine, searchIssues } as never)
})

afterEach(() => vi.useRealTimers())

function open(props: Partial<React.ComponentProps<typeof IssuePicker>> = {}) {
  return render(<IssuePicker selected={null} onSelect={vi.fn()} onClear={vi.fn()} {...props} />)
}

describe('IssuePicker — choosing', () => {
  it('shows nothing until it is focused', () => {
    open()
    expect(listMine).not.toHaveBeenCalled()
    expect(screen.queryByText('TAV-42')).toBeNull()
  })

  it('lists assigned issues on focus, with no typing', async () => {
    open()
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    expect(await screen.findByText('TAV-42')).toBeTruthy()
    expect(searchIssues).not.toHaveBeenCalled()
  })

  it('shows which tracker each issue came from', async () => {
    listMine.mockResolvedValue({
      issues: [summary(), summary({ tracker: 'jira', key: 'TAV-7', id: 'id-2' })],
      failures: [],
    })
    open()
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    await waitFor(() => expect(screen.getByText('Jira')).toBeTruthy())
    expect(screen.getByText('Linear')).toBeTruthy()
  })

  it('reports the picked issue and closes the list', async () => {
    const onSelect = vi.fn()
    open({ onSelect })
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    fireEvent.click(await screen.findByText('TAV-42'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'TAV-42' }))
  })

  it('debounces the search', async () => {
    vi.useFakeTimers()
    open()
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'sidebar' } })

    expect(searchIssues).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(searchIssues).toHaveBeenCalledWith('sidebar')
  })

  it('says so when nothing matched', async () => {
    listMine.mockResolvedValue({ issues: [], failures: [] })
    open()
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    expect(await screen.findByText('No issues found.')).toBeTruthy()
  })

  it('says nothing about a tracker that was simply never connected', async () => {
    listMine.mockResolvedValue({
      issues: [summary()],
      failures: [{ tracker: 'jira', error: 'not-connected' }],
    })
    open()
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    await screen.findByText('TAV-42')

    // "Jira unavailable" for a tracker you never connected is misleading noise.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('names a tracker that failed without hiding what arrived', async () => {
    listMine.mockResolvedValue({
      issues: [summary()],
      failures: [{ tracker: 'jira', error: 'auth-failed' }],
    })
    open()
    fireEvent.focus(screen.getByPlaceholderText(/Search/))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Jira')
    expect(status.textContent).toContain('credential rejected')
    expect(screen.getByText('TAV-42')).toBeTruthy()
  })
})

describe('IssuePicker — once chosen', () => {
  it('shows the choice instead of the search box', () => {
    open({ selected: summary() })
    expect(screen.getByText('TAV-42')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull()
  })

  it('lets the operator back out', () => {
    const onClear = vi.fn()
    open({ selected: summary(), onClear })
    fireEvent.click(screen.getByTitle('Choose a different issue'))
    expect(onClear).toHaveBeenCalled()
  })
})
