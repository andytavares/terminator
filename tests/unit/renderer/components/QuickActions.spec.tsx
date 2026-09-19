import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickActions } from '../../../../src/renderer/components/QuickActions'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

vi.mock('../../../../src/renderer/components/QuickActions.css', () => ({}))

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

const groups: QuickActionGroup[] = [
  { id: 'terminal', mnemonic: 't', label: 'Terminal' },
  { id: 'git', mnemonic: 'g', label: 'Git' },
]

function makeActions(): QuickAction[] {
  return [
    {
      id: 'terminal.split',
      label: 'Split right',
      group: 'terminal',
      mnemonic: 'd',
      shortcut: '⌘D',
      run: vi.fn(),
    },
    {
      id: 'terminal.split-down',
      label: 'Split down',
      group: 'terminal',
      mnemonic: 'D',
      shortcut: '⌘⇧D',
      run: vi.fn(),
    },
    { id: 'git.push', label: 'Push', group: 'git', mnemonic: 'p', run: vi.fn() },
    {
      id: 'git.pull',
      label: 'Pull',
      group: 'git',
      mnemonic: 'l',
      disabledReason: 'No repository focused',
      run: vi.fn(),
    },
    { id: 'top.home', label: 'Home', group: 'top', mnemonic: 'h', shortcut: '⌘`', run: vi.fn() },
  ]
}

let onRun: ReturnType<typeof vi.fn>
let onTogglePin: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

beforeEach(() => {
  onRun = vi.fn()
  onTogglePin = vi.fn()
  onClose = vi.fn()
})

function renderPanel(overrides: Partial<React.ComponentProps<typeof QuickActions>> = {}) {
  const actions = makeActions()
  const push = actions.find((a) => a.id === 'git.push')!
  const split = actions.find((a) => a.id === 'terminal.split')!
  return render(
    <QuickActions
      groups={groups}
      actions={actions}
      pinned={[push]}
      recent={[split]}
      pins={['git.push']}
      contextGroupId={null}
      onRun={onRun}
      onTogglePin={onTogglePin}
      onClose={onClose}
      {...overrides}
    />
  )
}

describe('QuickActions — top level', () => {
  it('has the dialog role and accessible name', () => {
    renderPanel()
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy()
  })

  it('renders Pinned & recent, Groups and Go sections', () => {
    renderPanel()
    expect(screen.getByText('Pinned & recent')).toBeTruthy()
    expect(screen.getByText('Groups')).toBeTruthy()
    expect(screen.getByText('Go')).toBeTruthy()
    expect(screen.getByText('Push')).toBeTruthy()
    expect(screen.getByText('Split right')).toBeTruthy()
    expect(screen.getByText('Terminal')).toBeTruthy()
    expect(screen.getByText('Home')).toBeTruthy()
  })

  it('prefixes a pinned/recent row with its group name', () => {
    renderPanel()
    expect(screen.getByText('Git ·')).toBeTruthy()
  })

  it('shows a pin glyph on a pinned row', () => {
    const { container } = renderPanel()
    const pushRow = screen.getByText('Push').closest('.qa-row')!
    expect(pushRow.querySelector('.qa-pin-indicator')).toBeTruthy()
    const splitRow = screen.getByText('Split right').closest('.qa-row')!
    expect(splitRow.querySelector('.qa-pin-indicator')).toBeNull()
    expect(container).toBeTruthy()
  })

  it('omits the context section when there is no context group', () => {
    renderPanel({ contextGroupId: null })
    expect(screen.queryByText(/· here/)).toBeNull()
  })

  it('renders a context section first, and ranks its group first among Groups', () => {
    renderPanel({ contextGroupId: 'git', contextLabel: 'in Git' })
    expect(screen.getByText('Git · here')).toBeTruthy()
    expect(screen.getByText('in Git')).toBeTruthy()
    const groupLabels = [...screen.getAllByText(/^(Terminal|Git)$/)]
    // First "Git"/"Terminal" text among the Groups section rows is Git, since
    // orderGroups puts the context group first.
    const listboxes = screen.getAllByRole('listbox')
    const groupsListbox = listboxes.find((el) => el.getAttribute('aria-label') === 'Groups')!
    const firstOption = groupsListbox.querySelectorAll('[role="option"]')[0]
    expect(firstOption.textContent).toContain('Git')
    expect(groupLabels.length).toBeGreaterThan(0)
  })
})

describe('QuickActions — group mode', () => {
  it('enters a group by its mnemonic and runs an action inside it', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 't' })
    expect(screen.getByText('Split right')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'd' })
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split' }))
  })

  it('is case-sensitive: "D" runs a different action than "d"', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 't' })
    fireEvent.keyDown(window, { key: 'D' })
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split-down' }))
    expect(onRun).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split' }))
  })

  it('goes back to top level on Backspace', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 't' })
    expect(screen.queryByText('Groups')).toBeNull()
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(screen.getByText('Groups')).toBeTruthy()
  })

  it('never runs a disabled action, and shows its reason in the footer status region', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'l' })
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('No repository focused')
  })
})

describe('QuickActions — search mode', () => {
  it('switches to search on "/" and filters by typing', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: '/' })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'push' } })
    expect(screen.getByText('Push')).toBeTruthy()
    expect(screen.queryByText('Split right')).toBeNull()
  })

  it('switches to search when searchSignal increments', () => {
    const { rerender } = renderPanel({ searchSignal: 1 })
    expect(screen.queryByRole('combobox')).toBeNull()
    const actions = makeActions()
    rerender(
      <QuickActions
        groups={groups}
        actions={actions}
        pinned={[]}
        recent={[]}
        pins={[]}
        contextGroupId={null}
        searchSignal={2}
        onRun={onRun}
        onTogglePin={onTogglePin}
        onClose={onClose}
      />
    )
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('runs the first match on Enter', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'push' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'git.push' }))
  })

  it('goes back to top level on Backspace when the query is empty', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(screen.getByText('Groups')).toBeTruthy()
  })

  it('navigates results with arrow keys', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p' } })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRun).toHaveBeenCalled()
  })
})

describe('QuickActions — pinning', () => {
  it('toggles the pin on the highlighted row with cmd+.', () => {
    renderPanel()
    // Highlight starts on the first pinned/recent row: Push.
    fireEvent.keyDown(window, { key: '.', metaKey: true })
    expect(onTogglePin).toHaveBeenCalledWith('git.push')
  })

  it('exposes a hover pin button with an accessible name, and it calls onTogglePin', () => {
    renderPanel()
    const button = screen.getByRole('button', { name: 'Unpin Push' })
    fireEvent.click(button)
    expect(onTogglePin).toHaveBeenCalledWith('git.push')
  })

  it('names an unpinned row\'s button "Pin <label>"', () => {
    renderPanel()
    const button = screen.getByRole('button', { name: 'Pin Split right' })
    fireEvent.click(button)
    expect(onTogglePin).toHaveBeenCalledWith('terminal.split')
  })
})

describe('QuickActions — closing', () => {
  it('closes on Escape', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on an outside mousedown', () => {
    const { container } = renderPanel()
    const overlay = container.querySelector('.qa-overlay')!
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when the panel itself is clicked', () => {
    const { container } = renderPanel()
    const panel = container.querySelector('.qa-panel')!
    fireEvent.mouseDown(panel)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('QuickActions — arrow navigation', () => {
  it('moves the highlight and runs the highlighted row on Enter', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split' }))
  })

  it('does not move the highlight past the first row on ArrowUp', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'git.push' }))
  })
})
