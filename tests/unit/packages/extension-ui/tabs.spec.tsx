import React, { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tabs, type TabItem } from '../../../../packages/extension-ui/src/Tabs'

const TABS: TabItem[] = [
  { id: 'files', label: 'Files', panel: <p>File list</p> },
  { id: 'checks', label: 'Checks', panel: <p>Check list</p> },
  { id: 'notes', label: 'Notes', panel: <p>Note list</p>, disabled: true },
  { id: 'history', label: 'History', panel: <p>Commit history</p> },
]

function Harness({ initial = 'files' }: { initial?: string }): JSX.Element {
  const [selectedId, setSelectedId] = useState(initial)
  return (
    <Tabs
      label="Pull request sections"
      tabs={TABS}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })

describe('Tabs', () => {
  it('names the tab list', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Pull request sections' })).toBeTruthy()
  })

  it('selects one tab and shows only its panel', () => {
    render(<Harness />)
    expect(tab('Files').getAttribute('aria-selected')).toBe('true')
    expect(tab('Checks').getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').textContent).toBe('File list')
  })

  it('ties the panel to its tab both ways', () => {
    render(<Harness />)
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Files').id)
    expect(tab('Files').getAttribute('aria-controls')).toBe(panel.id)
  })

  it('puts only the selected tab in the Tab order', () => {
    render(<Harness />)
    expect(tab('Files').tabIndex).toBe(0)
    expect(tab('Checks').tabIndex).toBe(-1)
  })

  it('selects a tab when it is clicked', () => {
    render(<Harness />)
    fireEvent.click(tab('Checks'))
    expect(tab('Checks').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toBe('Check list')
  })

  it('moves focus and selection with the arrow keys', () => {
    render(<Harness />)
    tab('Files').focus()
    fireEvent.keyDown(tab('Files'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Checks'))
    expect(tab('Checks').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Checks'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tab('Files'))
  })

  it('skips a disabled tab', () => {
    render(<Harness initial="checks" />)
    fireEvent.keyDown(tab('Checks'), { key: 'ArrowRight' })
    expect(tab('History').getAttribute('aria-selected')).toBe('true')
  })

  it('wraps from the last tab to the first and back', () => {
    render(<Harness initial="history" />)
    fireEvent.keyDown(tab('History'), { key: 'ArrowRight' })
    expect(tab('Files').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Files'), { key: 'ArrowLeft' })
    expect(tab('History').getAttribute('aria-selected')).toBe('true')
  })

  it('jumps to the ends with Home and End', () => {
    render(<Harness initial="checks" />)
    fireEvent.keyDown(tab('Checks'), { key: 'End' })
    expect(tab('History').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('History'), { key: 'Home' })
    expect(tab('Files').getAttribute('aria-selected')).toBe('true')
  })

  it('leaves other keys to the browser', () => {
    render(<Harness />)
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    tab('Files').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(tab('Files').getAttribute('aria-selected')).toBe('true')
  })

  it('does not select a disabled tab by click', () => {
    render(<Harness />)
    fireEvent.click(tab('Notes'))
    expect(tab('Files').getAttribute('aria-selected')).toBe('true')
  })
})
