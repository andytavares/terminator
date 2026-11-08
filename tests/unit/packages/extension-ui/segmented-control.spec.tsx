import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function SegmentedHarness({ initial = 'note' }: { initial?: string }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return <SegmentedControl label="Kind" options={OPTIONS} value={value} onChange={setValue} />
}

const radioOption = (name: string) => screen.getByRole('radio', { name })

describe('SegmentedControl', () => {
  it('is a named radio group', () => {
    render(<SegmentedHarness />)
    expect(screen.getByRole('radiogroup').getAttribute('aria-label')).toBe('Kind')
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

  it('chooses an option when it is clicked', async () => {
    const user = userEvent.setup()
    render(<SegmentedHarness />)
    await user.click(radioOption('Diagram'))
    expect(radioOption('Diagram').getAttribute('aria-checked')).toBe('true')
  })
})

describe('SegmentedControl — moves focus and the choice with the arrow keys, skipping a disabled option', () => {
  it('moves focus and the choice with the arrow keys, skipping a disabled option', async () => {
    const user = userEvent.setup()
    render(<SegmentedHarness initial="diagram" />)
    await user.tab()
    expect(radioOption('Diagram').matches(':focus')).toBe(true)
    await user.keyboard('{ArrowRight}')
    expect(radioOption('Link').getAttribute('aria-checked')).toBe('true')
    expect(radioOption('Link').matches(':focus')).toBe(true)
    await user.keyboard('{ArrowDown}')
    expect(radioOption('Note').getAttribute('aria-checked')).toBe('true')
    await user.keyboard('{ArrowUp}')
    expect(radioOption('Link').getAttribute('aria-checked')).toBe('true')
    await user.keyboard('{ArrowLeft}')
    expect(radioOption('Diagram').getAttribute('aria-checked')).toBe('true')
  })
})

describe('SegmentedControl — Home, End and other keys', () => {
  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup()
    render(<SegmentedHarness initial="diagram" />)
    await user.tab()
    expect(radioOption('Diagram').matches(':focus')).toBe(true)
    await user.keyboard('{End}')
    expect(radioOption('Link').getAttribute('aria-checked')).toBe('true')
    await user.keyboard('{Home}')
    expect(radioOption('Note').getAttribute('aria-checked')).toBe('true')
  })

  it('does not report a choice for a key it does not handle', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedControl label="Kind" options={OPTIONS} value="note" onChange={onChange} />)
    await user.tab()
    expect(radioOption('Note').matches(':focus')).toBe(true)
    await user.keyboard('a')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SegmentedControl — leaves a disabled option unpressable', () => {
  it('leaves a disabled option unpressable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedControl label="Kind" options={OPTIONS} value="note" onChange={onChange} />)
    expect(radioOption('Folder')).toHaveProperty('disabled', true)
    await user.click(radioOption('Folder'))
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
    expect(radioOption('30 days').textContent).toBe('30d')
  })
})
