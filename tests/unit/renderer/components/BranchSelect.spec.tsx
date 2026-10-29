import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('opens dropdown on trigger click', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
  })

  it('lists all branches when open', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByText('feature/a')).toBeTruthy()
    expect(screen.getByText('feature/b')).toBeTruthy()
  })
})

describe('BranchSelect — filters branches by search input', () => {
  it('filters branches by search input', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.change(screen.getByPlaceholderText('Search branches…'), {
      target: { value: 'feature/a' },
    })
    expect(screen.getByText('feature/a')).toBeTruthy()
    expect(screen.queryByText('feature/b')).toBeNull()
  })

  it('forgets the search text once the dropdown closes', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /main/i })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByPlaceholderText('Search branches…'), {
      target: { value: 'feature/a' },
    })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect((screen.getByPlaceholderText('Search branches…') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('feature/b')).toBeTruthy()
  })
})

describe('BranchSelect — shows no matching branches message when filter has no results', () => {
  it('shows no matching branches message when filter has no results', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.change(screen.getByPlaceholderText('Search branches…'), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText('No matching branches')).toBeTruthy()
  })

  it('calls onChange and closes dropdown when branch is selected', () => {
    const onChange = vi.fn()
    render(<BranchSelect branches={branches} value="main" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.click(screen.getByText('feature/a'))
    expect(onChange).toHaveBeenCalledWith('feature/a')
    expect(recordUse).toHaveBeenCalledWith('core.sidebar.branch-switch')
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })

  it('closes dropdown on Escape key', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
    fireEvent.keyDown(screen.getByPlaceholderText('Search branches…'), { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })
})

describe('BranchSelect — shows current branch check mark', () => {
  it('shows current branch check mark', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByText('✓')).toBeTruthy()
  })

  it('shows newBranchLabel option when provided', () => {
    render(
      <BranchSelect
        branches={branches}
        value="main"
        onChange={vi.fn()}
        newBranchLabel="+ New branch…"
        onNewBranch={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByText('+ New branch…')).toBeTruthy()
  })
})

describe('BranchSelect — calls onNewBranch and closes when new branch option is clicked', () => {
  it('calls onNewBranch and closes when new branch option is clicked', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.click(screen.getByText('+ New branch…'))
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

  it('toggles dropdown closed when trigger is clicked again', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /main/i })
    fireEvent.click(trigger)
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })

  it('shows empty state when no branches and no filter', () => {
    render(<BranchSelect branches={[]} value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('Select branch…'))
    expect(screen.getByText('No branches')).toBeTruthy()
  })
})

const openSelect = (props: Partial<React.ComponentProps<typeof BranchSelect>> = {}): void => {
  render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} {...props} />)
  fireEvent.click(document.querySelector('.branch-select__trigger')!)
}
const activeItems = (): string[] =>
  [...document.querySelectorAll('.branch-select__item--active')].map((el) => el.textContent ?? '')

describe('BranchSelect — closing on a press elsewhere', () => {
  it('closes on a pointer press outside it, and stays open for one inside', () => {
    openSelect()
    fireEvent.pointerDown(screen.getByPlaceholderText('Search branches…'))
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })
})

describe('BranchSelect — the chosen item', () => {
  it('marks the selected branch', () => {
    openSelect()
    expect(activeItems()).toEqual(['✓main'])
  })

  it('marks the new-branch item instead while it is chosen', () => {
    openSelect({ newBranchLabel: '+ New branch…', onNewBranch: vi.fn(), isNewSelected: true })
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

  it('fetches on click, and is disabled and marked busy while fetching', () => {
    const onRefresh = vi.fn()
    const { rerender } = render(
      <BranchSelect branches={branches} value="main" onChange={vi.fn()} onRefresh={onRefresh} />
    )
    const fetch = screen.getByRole('button', { name: 'Fetch branches' })
    fireEvent.click(fetch)
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
