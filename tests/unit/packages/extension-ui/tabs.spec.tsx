import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TabsRoot,
  type TabItem,
} from '../../../../packages/extension-ui/src/Tabs'

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

describe('Tabs with a rich label', () => {
  it('takes its accessible name from accessibleName when the label is markup', () => {
    render(
      <Tabs
        label="Dashboard sections"
        tabs={[
          {
            id: 'needs',
            label: (
              <>
                Needs you<span>3</span>
              </>
            ),
            accessibleName: 'Needs you, 3',
            panel: <p>Rows</p>,
          },
        ]}
        selectedId="needs"
        onSelect={() => {}}
      />
    )
    expect(tab('Needs you, 3').textContent).toBe('Needs you3')
  })
})

function PartsHarness({
  initial = 'needs',
  orientation,
  withPanels = true,
}: {
  initial?: string
  orientation?: 'horizontal' | 'vertical'
  withPanels?: boolean
}): JSX.Element {
  const [selectedId, setSelectedId] = useState(initial)
  return (
    <TabsRoot selectedId={selectedId} onSelect={setSelectedId}>
      <div role="toolbar" aria-label="Reviews toolbar">
        <TabList label="Dashboard sections" orientation={orientation}>
          <Tab id="needs" accessibleName="Needs you, 3">
            Needs you<span>3</span>
          </Tab>
          <Tab id="mine">My PRs</Tab>
          <Tab id="later" disabled>
            Later
          </Tab>
          <Tab id="involved">Involved</Tab>
        </TabList>
        <button type="button">Refresh</button>
      </div>
      <p>Loading reviews…</p>
      {withPanels && (
        <>
          <TabPanel id="needs">Needs rows</TabPanel>
          <TabPanel id="mine">Mine rows</TabPanel>
          <TabPanel id="involved">Involved rows</TabPanel>
        </>
      )}
    </TabsRoot>
  )
}

describe('Tabs parts: TabsRoot, TabList, Tab, TabPanel', () => {
  it('lets the list share a row with other controls and the panel sit elsewhere', () => {
    render(<PartsHarness />)
    const toolbar = screen.getByRole('toolbar')
    expect(within(toolbar).getByRole('tablist', { name: 'Dashboard sections' })).toBeTruthy()
    expect(within(toolbar).queryByRole('tabpanel')).toBeNull()
    expect(screen.getByRole('tabpanel').textContent).toBe('Needs rows')
  })

  it('names a tab with markup inside by its accessibleName', () => {
    render(<PartsHarness />)
    expect(tab('Needs you, 3').getAttribute('aria-selected')).toBe('true')
  })

  it('ties the selected tab and its panel both ways', () => {
    render(<PartsHarness />)
    const panel = screen.getByRole('tabpanel')
    expect(tab('Needs you, 3').getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Needs you, 3').id)
  })

  it('points aria-controls only at a panel that is in the document', () => {
    render(<PartsHarness />)
    for (const element of screen.getAllByRole('tab')) {
      const controls = element.getAttribute('aria-controls')
      if (controls) expect(document.getElementById(controls)).not.toBeNull()
    }
    expect(tab('My PRs').hasAttribute('aria-controls')).toBe(false)
  })

  it('leaves aria-controls off when the caller renders no panel', () => {
    render(<PartsHarness withPanels={false} />)
    expect(tab('Needs you, 3').hasAttribute('aria-controls')).toBe(false)
  })

  it('moves the panel with the selection on click', () => {
    render(<PartsHarness />)
    fireEvent.click(tab('My PRs'))
    expect(screen.getByRole('tabpanel').textContent).toBe('Mine rows')
    expect(tab('My PRs').getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id)
  })

  it('keeps one roving tab stop on the selected tab', () => {
    render(<PartsHarness initial="mine" />)
    expect(screen.getAllByRole('tab').map((element) => element.tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('moves focus and selection with Left and Right, skipping disabled tabs and wrapping', () => {
    render(<PartsHarness initial="mine" />)
    fireEvent.keyDown(tab('My PRs'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Involved'))
    expect(tab('Involved').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Involved'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Needs you, 3'))
    fireEvent.keyDown(tab('Needs you, 3'), { key: 'ArrowLeft' })
    expect(tab('Involved').getAttribute('aria-selected')).toBe('true')
  })

  it('jumps to the ends with Home and End', () => {
    render(<PartsHarness initial="mine" />)
    fireEvent.keyDown(tab('My PRs'), { key: 'End' })
    expect(document.activeElement).toBe(tab('Involved'))
    fireEvent.keyDown(tab('Involved'), { key: 'Home' })
    expect(document.activeElement).toBe(tab('Needs you, 3'))
  })

  it('uses Up and Down, not Left and Right, in a vertical list', () => {
    render(<PartsHarness orientation="vertical" />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical')
    fireEvent.keyDown(tab('Needs you, 3'), { key: 'ArrowRight' })
    expect(tab('Needs you, 3').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Needs you, 3'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tab('My PRs'))
    fireEvent.keyDown(tab('My PRs'), { key: 'ArrowUp' })
    expect(tab('Needs you, 3').getAttribute('aria-selected')).toBe('true')
  })

  it('refuses a Tab outside a TabsRoot, which would have nothing to select', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Tab id="lost">Lost</Tab>)).toThrow(/TabsRoot/)
    quiet.mockRestore()
  })
})
