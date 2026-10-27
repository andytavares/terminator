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

function TabsHarness({ initial = 'files' }: { initial?: string }): JSX.Element {
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

const tabNamed = (name: string) => screen.getByRole('tab', { name })

describe('Tabs', () => {
  it('names the tab list', () => {
    render(<TabsHarness />)
    expect(screen.getByRole('tablist', { name: 'Pull request sections' })).toBeTruthy()
  })

  it('selects one tab and shows only its panel', () => {
    render(<TabsHarness />)
    expect(tabNamed('Files').getAttribute('aria-selected')).toBe('true')
    expect(tabNamed('Checks').getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').textContent).toBe('File list')
  })

  it('ties the panel to its tab both ways', () => {
    render(<TabsHarness />)
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabNamed('Files').id)
    expect(tabNamed('Files').getAttribute('aria-controls')).toBe(panel.id)
  })

  it('puts only the selected tab in the Tab order', () => {
    render(<TabsHarness />)
    expect(tabNamed('Files').tabIndex).toBe(0)
    expect(tabNamed('Checks').tabIndex).toBe(-1)
  })

  it('selects a tab when it is clicked', () => {
    render(<TabsHarness />)
    fireEvent.click(tabNamed('Checks'))
    expect(tabNamed('Checks').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toBe('Check list')
  })
})

describe('Tabs — moves focus and selection with the arrow keys', () => {
  it('moves focus and selection with the arrow keys', () => {
    render(<TabsHarness />)
    tabNamed('Files').focus()
    fireEvent.keyDown(tabNamed('Files'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabNamed('Checks'))
    expect(tabNamed('Checks').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabNamed('Checks'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabNamed('Files'))
  })

  it('skips a disabled tab', () => {
    render(<TabsHarness initial="checks" />)
    fireEvent.keyDown(tabNamed('Checks'), { key: 'ArrowRight' })
    expect(tabNamed('History').getAttribute('aria-selected')).toBe('true')
  })

  it('wraps from the last tab to the first and back', () => {
    render(<TabsHarness initial="history" />)
    fireEvent.keyDown(tabNamed('History'), { key: 'ArrowRight' })
    expect(tabNamed('Files').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabNamed('Files'), { key: 'ArrowLeft' })
    expect(tabNamed('History').getAttribute('aria-selected')).toBe('true')
  })
})

describe('Tabs — jumps to the ends with Home and End', () => {
  it('jumps to the ends with Home and End', () => {
    render(<TabsHarness initial="checks" />)
    fireEvent.keyDown(tabNamed('Checks'), { key: 'End' })
    expect(tabNamed('History').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabNamed('History'), { key: 'Home' })
    expect(tabNamed('Files').getAttribute('aria-selected')).toBe('true')
  })

  it('leaves other keys to the browser', () => {
    render(<TabsHarness />)
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    tabNamed('Files').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(tabNamed('Files').getAttribute('aria-selected')).toBe('true')
  })

  it('does not select a disabled tab by click', () => {
    render(<TabsHarness />)
    fireEvent.click(tabNamed('Notes'))
    expect(tabNamed('Files').getAttribute('aria-selected')).toBe('true')
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
    expect(tabNamed('Needs you, 3').textContent).toBe('Needs you3')
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
        <HarnessTabList orientation={orientation} />
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

function HarnessTabList({ orientation }: { orientation?: 'horizontal' | 'vertical' }) {
  return (
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
    expect(tabNamed('Needs you, 3').getAttribute('aria-selected')).toBe('true')
  })

  it('ties the selected tab and its panel both ways', () => {
    render(<PartsHarness />)
    const panel = screen.getByRole('tabpanel')
    expect(tabNamed('Needs you, 3').getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tabNamed('Needs you, 3').id)
  })

  it('points aria-controls only at a panel that is in the document', () => {
    render(<PartsHarness />)
    const controlled = screen
      .getAllByRole('tab')
      .map((element) => element.getAttribute('aria-controls'))
      .filter((id): id is string => id !== null)
    expect(controlled.length).toBeGreaterThan(0)
    expect(controlled.filter((id) => document.getElementById(id) === null)).toEqual([])
    expect(tabNamed('My PRs').hasAttribute('aria-controls')).toBe(false)
  })
})

describe('Tabs parts: TabsRoot, TabList, Tab, TabPanel — leaves aria-controls off when the caller renders no panel', () => {
  it('leaves aria-controls off when the caller renders no panel', () => {
    render(<PartsHarness withPanels={false} />)
    expect(tabNamed('Needs you, 3').hasAttribute('aria-controls')).toBe(false)
  })

  it('moves the panel with the selection on click', () => {
    render(<PartsHarness />)
    fireEvent.click(tabNamed('My PRs'))
    expect(screen.getByRole('tabpanel').textContent).toBe('Mine rows')
    expect(tabNamed('My PRs').getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id)
  })

  it('keeps one roving tab stop on the selected tab', () => {
    render(<PartsHarness initial="mine" />)
    expect(screen.getAllByRole('tab').map((element) => element.tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('moves focus and selection with Left and Right, skipping disabled tabs and wrapping', () => {
    render(<PartsHarness initial="mine" />)
    fireEvent.keyDown(tabNamed('My PRs'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabNamed('Involved'))
    expect(tabNamed('Involved').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabNamed('Involved'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabNamed('Needs you, 3'))
    fireEvent.keyDown(tabNamed('Needs you, 3'), { key: 'ArrowLeft' })
    expect(tabNamed('Involved').getAttribute('aria-selected')).toBe('true')
  })
})

describe('Tabs parts: TabsRoot, TabList, Tab, TabPanel — jumps to the ends with Home and End', () => {
  it('jumps to the ends with Home and End', () => {
    render(<PartsHarness initial="mine" />)
    fireEvent.keyDown(tabNamed('My PRs'), { key: 'End' })
    expect(document.activeElement).toBe(tabNamed('Involved'))
    fireEvent.keyDown(tabNamed('Involved'), { key: 'Home' })
    expect(document.activeElement).toBe(tabNamed('Needs you, 3'))
  })

  it('uses Up and Down, not Left and Right, in a vertical list', () => {
    render(<PartsHarness orientation="vertical" />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical')
    fireEvent.keyDown(tabNamed('Needs you, 3'), { key: 'ArrowRight' })
    expect(tabNamed('Needs you, 3').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabNamed('Needs you, 3'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabNamed('My PRs'))
    fireEvent.keyDown(tabNamed('My PRs'), { key: 'ArrowUp' })
    expect(tabNamed('Needs you, 3').getAttribute('aria-selected')).toBe('true')
  })

  it('refuses a Tab outside a TabsRoot, which would have nothing to select', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Tab id="lost">Lost</Tab>)).toThrow(/TabsRoot/)
    quiet.mockRestore()
  })
})

describe('Tabs with nothing selected', () => {
  it('keeps the first tab reachable by keyboard', () => {
    render(<TabsHarness initial="" />)
    expect(tabNamed('Files').getAttribute('tabindex')).toBe('0')
    expect(tabNamed('Checks').getAttribute('tabindex')).toBe('-1')
  })
  it('moves the stop to a tab once it is selected', () => {
    render(<TabsHarness initial="" />)
    fireEvent.click(tabNamed('Checks'))
    expect(tabNamed('Checks').getAttribute('tabindex')).toBe('0')
    expect(tabNamed('Files').getAttribute('tabindex')).toBe('-1')
  })
})
