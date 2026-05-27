import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BranchSelect } from '../../../../src/renderer/components/sidebar/BranchSelect'
import type { Branch } from '../../../../src/shared/types/index'

const branches: Branch[] = [
  { name: 'main', isCurrent: true, isRemote: false },
  { name: 'feature/a', isCurrent: false, isRemote: false },
  { name: 'feature/b', isCurrent: false, isRemote: false },
]

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

  it('filters branches by search input', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.change(screen.getByPlaceholderText('Search branches…'), {
      target: { value: 'feature/a' },
    })
    expect(screen.getByText('feature/a')).toBeTruthy()
    expect(screen.queryByText('feature/b')).toBeNull()
  })

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
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })

  it('closes dropdown on Escape key', () => {
    render(<BranchSelect branches={branches} value="main" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    expect(screen.getByPlaceholderText('Search branches…')).toBeTruthy()
    fireEvent.keyDown(screen.getByPlaceholderText('Search branches…'), { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Search branches…')).toBeNull()
  })

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
