import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { BranchSelect } from '../../../../src/renderer/components/sidebar/BranchSelect'
import type { Branch } from '../../../../src/shared/types/index'

const branches: Branch[] = [
  { name: 'main', isCurrent: true, isRemote: false },
  { name: 'feature/a', isCurrent: false, isRemote: false },
  { name: 'feature/b', isCurrent: false, isRemote: false },
]

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('BranchSelect', () => {
  it('renders the current value in the trigger', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    expect(screen.getByText('main')).toBeTruthy()
  })

  it('shows placeholder when value is empty', () => {
    render(<BranchSelect branches={branches} value="" onChange={vi.fn()} />)
    expect(screen.getByText('Select branch…')).toBeTruthy()
  })

  it('lists all branches when open', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByText('feature/a')).toBeTruthy()
    expect(screen.getByText('feature/b')).toBeTruthy()
  })
})

describe('BranchSelect — filters branches by search input', () => {
  it('filters branches by search input', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /main/i }))
    await user.type(screen.getByPlaceholderText('Search branches…'), 'feature/a')
    expect(screen.getByText('feature/a')).toBeTruthy()
    expect(screen.queryByText('feature/b')).toBeNull()
  })

  it('forgets the search text once the dropdown closes', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /main/i })
    await user.click(trigger)
    await user.type(screen.getByPlaceholderText('Search branches…'), 'feature/a')
    await user.click(trigger)
    await user.click(trigger)
    expect((screen.getByPlaceholderText('Search branches…') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('feature/b')).toBeTruthy()
  })
})

describe('BranchSelect — shows no matching branches message when filter has no results', () => {
  it('shows no matching branches message when filter has no results', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /main/i }))
    await user.type(screen.getByPlaceholderText('Search branches…'), 'zzz')
    expect(screen.getByText('No matching branches')).toBeTruthy()
  })

  it('calls onChange and closes dropdown when branch is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BranchSelect branches={branches} value="main" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /main/i }))
    await user.click(screen.getByText('feature/a'))
    expect(onChange).toHaveBeenCalledWith('feature/a')
    expect(recordUse).toHaveBeenCalledWith('core.sidebar.branch-switch')
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByPlaceholderText('Search branches…').matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })
})

describe('BranchSelect — calls onNewBranch and closes when new branch option is clicked', () => {
  it('calls onNewBranch and closes when new branch option is clicked', async () => {
    const user = userEvent.setup()
    const onNewBranch = vi.fn()
    render(
      <BranchSelect
        branches={branches}
        value="main"
        onChange={vi.fn()}
        newBranchLabel="+ New branch…"
        onNewBranch={onNewBranch}
      />
    )
    await user.click(screen.getByRole('button', { name: /main/i }))
    await user.click(screen.getByText('+ New branch…'))
    expect(onNewBranch).toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })
})

describe('BranchSelect — shows isNewSelected label in trigger when isNewSelected is true', () => {
  it('shows isNewSelected label in trigger when isNewSelected is true', () => {
    render(
      <BranchSelect
        branches={branches}
        value=""
        onChange={vi.fn()}
        newBranchLabel="+ New branch…"
        onNewBranch={vi.fn()}
        isNewSelected
      />
    )
    expect(screen.getByText('+ New branch…')).toBeTruthy()
  })

  it('toggles dropdown closed when trigger is clicked again', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /main/i })
    await user.click(trigger)
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
    await user.click(trigger)
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })

  it('shows empty state when no branches and no filter', async () => {
    const user = userEvent.setup()
    render(<BranchSelect branches={[]} value="" onChange={vi.fn()} />)
    await user.click(screen.getByText('Select branch…'))
    expect(screen.getByText('No branches')).toBeTruthy()
  })
})

async function openSelect(
  props: Partial<React.ComponentProps<typeof BranchSelect>> = {}
): Promise<UserEvent> {
  const user = userEvent.setup()
  render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} {...props} />)
  await user.click(screen.getByRole('button', { expanded: false }))
  return user
}
const activeItems = (): string[] =>
  screen.getAllByRole('button', { current: true }).map((el) => el.textContent ?? '')

describe('BranchSelect — closing on a press elsewhere', () => {
  it('closes on a pointer press outside it, and stays open for one inside', async () => {
    const user = await openSelect()
    await user.click(screen.getByPlaceholderText('Search branches…'))
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
    await user.click(document.body)
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })
})

describe('BranchSelect — the chosen item', () => {
  it('marks the selected branch', async () => {
    await openSelect()
    expect(activeItems()).toEqual(['✓main'])
  })

  it('marks the new-branch item instead while it is chosen', async () => {
    await openSelect({ newBranchLabel: '+ New branch…', onNewBranch: vi.fn(), isNewSelected: true })
    expect(activeItems()).toEqual(['+ New branch…'])
  })

  it('names a chosen new branch generically when it has no label', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} isNewSelected />)
    expect(screen.getByText('New branch…')).toBeTruthy()
  })
})

describe('BranchSelect — fetching', () => {
  it('offers no fetch button without onRefresh', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Fetch branches' })).toBeNull()
  })

  it('fetches on click, and is disabled and marked busy while fetching', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    const { rerender } = render(
      <BranchSelect branches={branches} value="main" onChange={vi.fn()} onRefresh={onRefresh} />
    )
    const fetch = screen.getByRole('button', { name: 'Fetch branches' })
    await user.click(fetch)
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(fetch.className).toBe('branch-select__refresh')
    rerender(
      <BranchSelect
        branches={branches}
        value="main"
        onChange={vi.fn()}
        onRefresh={onRefresh}
        refreshing
      />
    )
    expect(fetch).toHaveProperty('disabled', true)
    expect(fetch.className).toBe('branch-select__refresh branch-select__refresh--busy')
  })
})
