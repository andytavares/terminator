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

function SegmentedHarness({ initial = 'note' }: { initial?: string }): JSX.Element {
  const [value, setValue] = useState(initial)
  return <SegmentedControl label="Kind" options={OPTIONS} value={value} onChange={setValue} />
}

const radioOption = (name: string) => screen.getByRole('radio', { name })

describe('SegmentedControl', () => {
  it('is a named radio group', () => {
    render(<SegmentedHarness />)
    expect(screen.getByRole('radiogroup', { name: 'Kind' })).toBeTruthy()
  })

  it('checks exactly the chosen option', () => {
    render(<SegmentedHarness initial="diagram" />)
    expect(radioOption('Diagram').getAttribute('aria-checked')).toBe('true')
    expect(radioOption('Note').getAttribute('aria-checked')).toBe('false')
  })

  it('puts only the chosen option in the Tab order', () => {
    render(<SegmentedHarness />)
    expect(radioOption('Note').tabIndex).toBe(0)
    expect(radioOption('Diagram').tabIndex).toBe(-1)
  })

  it('keeps the first enabled option reachable when nothing is chosen', () => {
    render(<SegmentedControl label="Kind" options={OPTIONS} value="none" onChange={() => {}} />)
    expect(radioOption('Note').tabIndex).toBe(0)
    expect(radioOption('Diagram').tabIndex).toBe(-1)
  })

  it('chooses an option when it is clicked', () => {
    render(<SegmentedHarness />)
    fireEvent.click(radioOption('Diagram'))
    expect(radioOption('Diagram').getAttribute('aria-checked')).toBe('true')
  })
})

describe('SegmentedControl — moves focus and the choice with the arrow keys, skipping a disabled option', () => {
  it('moves focus and the choice with the arrow keys, skipping a disabled option', () => {
    render(<SegmentedHarness initial="diagram" />)
    radioOption('Diagram').focus()
    fireEvent.keyDown(radioOption('Diagram'), { key: 'ArrowRight' })
    expect(radioOption('Link').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radioOption('Link'))
    fireEvent.keyDown(radioOption('Link'), { key: 'ArrowDown' })
    expect(radioOption('Note').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radioOption('Note'), { key: 'ArrowUp' })
    expect(radioOption('Link').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radioOption('Link'), { key: 'ArrowLeft' })
    expect(radioOption('Diagram').getAttribute('aria-checked')).toBe('true')
  })

  it('jumps to the ends with Home and End', () => {
    render(<SegmentedHarness initial="diagram" />)
    fireEvent.keyDown(radioOption('Diagram'), { key: 'End' })
    expect(radioOption('Link').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radioOption('Link'), { key: 'Home' })
    expect(radioOption('Note').getAttribute('aria-checked')).toBe('true')
  })

  it('does not report a choice for a key it does not handle', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Kind" options={OPTIONS} value="note" onChange={onChange} />)
    fireEvent.keyDown(radioOption('Note'), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SegmentedControl — leaves a disabled option unpressable', () => {
  it('leaves a disabled option unpressable', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Kind" options={OPTIONS} value="note" onChange={onChange} />)
    expect(radioOption('Folder')).toHaveProperty('disabled', true)
    fireEvent.click(radioOption('Folder'))
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
    expect(radioOption('30 days')).toBeTruthy()
  })
})
