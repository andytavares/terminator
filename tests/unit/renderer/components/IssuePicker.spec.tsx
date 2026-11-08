import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function open(props: Partial<React.ComponentProps<typeof IssuePicker>> = {}) {
  return render(<IssuePicker selected={null} onSelect={vi.fn()} onClear={vi.fn()} {...props} />)
}

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('IssuePicker — choosing', () => {
  it('shows nothing until it is focused', () => {
    open()
    expect(listMine).not.toHaveBeenCalled()
    expect(screen.queryByText('TAV-42')).toBeNull()
  })

  it('lists assigned issues on focus, with no typing', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByPlaceholderText(/Search/))
    await screen.findByText('TAV-42')
    expect(searchIssues).not.toHaveBeenCalled()
  })
})

describe('IssuePicker — tracker label', () => {
  it('shows which tracker each issue came from', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByPlaceholderText(/Search/))
    expect(await screen.findByText('Linear')).toBeTruthy()
  })
})

describe('IssuePicker — choosing — reports the picked issue and closes the list', () => {
  it('reports the picked issue and closes the list', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    open({ onSelect })
    await user.click(screen.getByPlaceholderText(/Search/))
    await user.click(await screen.findByText('TAV-42'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'TAV-42' }))
    expect(screen.queryByText('TAV-42')).toBeNull()
  })

  it('says so when nothing matched', async () => {
    const user = userEvent.setup()
    listMine.mockResolvedValue({ issues: [], failures: [] })
    open()
    await user.click(screen.getByPlaceholderText(/Search/))
    expect(await screen.findByText('No issues found.')).toBeTruthy()
  })
})

describe('IssuePicker — choosing — says nothing about a tracker that was simply never connected', () => {
  it('says nothing about a tracker that was simply never connected', async () => {
    const user = userEvent.setup()
    listMine.mockResolvedValue({
      issues: [summary()],
      failures: [{ tracker: 'linear', error: 'not-connected' }],
    })
    open()
    await user.click(screen.getByPlaceholderText(/Search/))
    await screen.findByText('TAV-42')

    // "Linear unavailable" for a tracker you never connected is misleading noise.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('names a tracker that failed without hiding what arrived', async () => {
    const user = userEvent.setup()
    listMine.mockResolvedValue({
      issues: [summary()],
      failures: [{ tracker: 'linear', error: 'auth-failed' }],
    })
    open()
    await user.click(screen.getByPlaceholderText(/Search/))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Linear')
    expect(status.textContent).toContain('credential rejected')
    expect(screen.getByText('TAV-42')).toBeTruthy()
  })
})

async function openList(user: ReturnType<typeof userEvent.setup>) {
  const view = open()
  await user.click(screen.getByPlaceholderText('Search, or type an issue key'))
  await screen.findByText('TAV-42')
  return view
}

describe('IssuePicker — dismissing the list', () => {
  it('closes on Escape, and keeps the key from reaching the dialog behind it', async () => {
    const user = userEvent.setup()
    const behind = vi.fn()
    render(<div onKeyDown={behind} />)
    await openList(user)
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search, or type an issue key'))
    await user.keyboard('{Escape}')
    expect(screen.queryByText('TAV-42')).toBeNull()
    expect(behind).not.toHaveBeenCalled()
  })

  it('lets Escape through once the list is already closed, so the dialog can take it', async () => {
    const user = userEvent.setup()
    const behind = vi.fn()
    const { container } = render(<div onKeyDown={behind} />)
    await openList(user)
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search, or type an issue key'))
    await user.keyboard('{Escape}')
    container.firstChild?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(behind).toHaveBeenCalled()
  })

  it('closes when the pointer goes down anywhere else', async () => {
    const user = userEvent.setup()
    await openList(user)
    await user.click(document.body)
    expect(screen.queryByText('TAV-42')).toBeNull()
  })
})

describe('IssuePicker — dismissing the list — stays open when the pointer goes down inside it', () => {
  it('stays open when the pointer goes down inside it', async () => {
    const user = userEvent.setup()
    await openList(user)
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByText('TAV-42') })
    expect(screen.getByText('TAV-42')).toBeTruthy()
  })

  it('opens again on the next focus', async () => {
    const user = userEvent.setup()
    await openList(user)
    await user.click(document.body)
    expect(screen.queryByText('TAV-42')).toBeNull()
    await user.click(screen.getByPlaceholderText('Search, or type an issue key'))
    await screen.findByText('TAV-42')
  })
})

describe('IssuePicker — once chosen', () => {
  it('shows the choice instead of the search box', () => {
    open({ selected: summary() })
    expect(screen.getByText('TAV-42')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull()
  })

  it('lets the operator back out', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    open({ selected: summary(), onClear })
    await user.click(screen.getByTitle('Choose a different issue'))
    expect(onClear).toHaveBeenCalled()
  })
})
