import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListInput, listItems } from '../../../../packages/extension-ui/src/ListInput'

function ListInputHarness({
  initial,
  onItems,
}: {
  initial: string[]
  onItems?: (items: string[]) => void
}) {
  const [items, setItems] = useState(initial)
  return (
    <ListInput
      label="Critical paths"
      value={items}
      onChange={(next) => {
        setItems(next)
        onItems?.(next)
      }}
    />
  )
}

const criticalPathsBox = () =>
  screen.getByRole('textbox', { name: 'Critical paths' }) as HTMLTextAreaElement

describe('listItems', () => {
  it('reads one item per line, trimmed, and skips blank lines', () => {
    expect(listItems('  src/auth/**\n\n migrations/** \n')).toEqual([
      'src/auth/**',
      'migrations/**',
    ])
    expect(listItems('')).toEqual([])
  })
})

describe('ListInput', () => {
  it('is a multi-line box named by its label, one item per line', () => {
    render(<ListInputHarness initial={['src/auth/**', 'migrations/**']} />)
    expect(criticalPathsBox().tagName).toBe('TEXTAREA')
    expect(criticalPathsBox().value).toBe('src/auth/**\nmigrations/**')
  })

  it('hands back the items as they are typed', async () => {
    const user = userEvent.setup()
    const onItems = vi.fn()
    render(<ListInputHarness initial={[]} onItems={onItems} />)
    await user.type(criticalPathsBox(), 'src/auth/**{Enter}  docs/** ')
    expect(onItems).toHaveBeenLastCalledWith(['src/auth/**', 'docs/**'])
  })

  it('keeps a new empty line while the next item is being typed', async () => {
    const user = userEvent.setup()
    render(<ListInputHarness initial={['src/auth/**']} />)
    await user.type(criticalPathsBox(), '{Enter}')
    expect(criticalPathsBox().value).toBe('src/auth/**\n')
  })

  it('shows a list changed from outside', () => {
    const { rerender } = render(
      <ListInput label="Critical paths" value={['a']} onChange={() => {}} />
    )
    rerender(<ListInput label="Critical paths" value={['b', 'c']} onChange={() => {}} />)
    expect(criticalPathsBox().value).toBe('b\nc')
  })
})
