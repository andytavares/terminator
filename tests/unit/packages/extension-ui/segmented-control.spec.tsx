import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  SegmentedControl,
  type SegmentedOption,
} from '../../../../packages/extension-ui/src/SegmentedControl'

const OPTIONS: SegmentedOption<string>[] = [
  { value: 'note', label: 'Note' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'folder', label: 'Folder', disabled: true },
  { value: 'link', label: 'Link' },
]

function Harness({ initial = 'note' }: { initial?: string }): JSX.Element {
  const [value, setValue] = useState(initial)
  return <SegmentedControl label="Kind" options={OPTIONS} value={value} onChange={setValue} />
}

const option = (name: string) => screen.getByRole('radio', { name })

describe('SegmentedControl', () => {
  it('is a named radio group', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Kind' })).toBeTruthy()
  })

  it('checks exactly the chosen option', () => {
    render(<Harness initial="diagram" />)
    expect(option('Diagram').getAttribute('aria-checked')).toBe('true')
    expect(option('Note').getAttribute('aria-checked')).toBe('false')
  })

  it('puts only the chosen option in the Tab order', () => {
    render(<Harness />)
    expect(option('Note').tabIndex).toBe(0)
    expect(option('Diagram').tabIndex).toBe(-1)
  })

  it('keeps the first enabled option reachable when nothing is chosen', () => {
    render(<SegmentedControl label="Kind" options={OPTIONS} value="none" onChange={() => {}} />)
    expect(option('Note').tabIndex).toBe(0)
    expect(option('Diagram').tabIndex).toBe(-1)
  })

  it('chooses an option when it is clicked', () => {
    render(<Harness />)
    fireEvent.click(option('Diagram'))
    expect(option('Diagram').getAttribute('aria-checked')).toBe('true')
  })
})

describe('SegmentedControl — moves focus and the choice with the arrow keys, skipping a disabled option', () => {
  it('moves focus and the choice with the arrow keys, skipping a disabled option', () => {
    render(<Harness initial="diagram" />)
    option('Diagram').focus()
    fireEvent.keyDown(option('Diagram'), { key: 'ArrowRight' })
    expect(option('Link').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(option('Link'))
    fireEvent.keyDown(option('Link'), { key: 'ArrowDown' })
    expect(option('Note').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('Note'), { key: 'ArrowUp' })
    expect(option('Link').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('Link'), { key: 'ArrowLeft' })
    expect(option('Diagram').getAttribute('aria-checked')).toBe('true')
  })

  it('jumps to the ends with Home and End', () => {
    render(<Harness initial="diagram" />)
    fireEvent.keyDown(option('Diagram'), { key: 'End' })
    expect(option('Link').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('Link'), { key: 'Home' })
    expect(option('Note').getAttribute('aria-checked')).toBe('true')
  })

  it('does not report a choice for a key it does not handle', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Kind" options={OPTIONS} value="note" onChange={onChange} />)
    fireEvent.keyDown(option('Note'), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SegmentedControl — leaves a disabled option unpressable', () => {
  it('leaves a disabled option unpressable', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Kind" options={OPTIONS} value="note" onChange={onChange} />)
    expect(option('Folder')).toHaveProperty('disabled', true)
    fireEvent.click(option('Folder'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('names an option whose label is more than words', () => {
    render(
      <SegmentedControl
        label="Window"
        options={[{ value: 'a', label: <span>30d</span>, accessibleName: '30 days' }]}
        value="a"
        onChange={() => {}}
      />
    )
    expect(option('30 days')).toBeTruthy()
  })
})
