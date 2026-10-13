import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ListInput, listItems } from '../../../../packages/extension-ui/src/ListInput'

function Harness({ initial, onItems }: { initial: string[]; onItems?: (items: string[]) => void }) {
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

const box = () => screen.getByRole('textbox', { name: 'Critical paths' }) as HTMLTextAreaElement
const type = (text: string) => fireEvent.change(box(), { target: { value: text } })

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
    render(<Harness initial={['src/auth/**', 'migrations/**']} />)
    expect(box().tagName).toBe('TEXTAREA')
    expect(box().value).toBe('src/auth/**\nmigrations/**')
  })

  it('hands back the items as they are typed', () => {
    const onItems = vi.fn()
    render(<Harness initial={[]} onItems={onItems} />)
    type('src/auth/**\n  docs/** ')
    expect(onItems).toHaveBeenLastCalledWith(['src/auth/**', 'docs/**'])
  })

  it('keeps a new empty line while the next item is being typed', () => {
    render(<Harness initial={['src/auth/**']} />)
    type('src/auth/**\n')
    expect(box().value).toBe('src/auth/**\n')
  })

  it('shows a list changed from outside', () => {
    const { rerender } = render(
      <ListInput label="Critical paths" value={['a']} onChange={() => {}} />
    )
    rerender(<ListInput label="Critical paths" value={['b', 'c']} onChange={() => {}} />)
    expect(box().value).toBe('b\nc')
  })
})
