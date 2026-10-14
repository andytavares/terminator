import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickActions } from '../../../../src/renderer/components/QuickActions'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'
import { pressOutside } from '../../../support/modal'

vi.mock('../../../../src/renderer/components/QuickActions.css', () => ({}))

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

const groups: QuickActionGroup[] = [
  { id: 'terminal', mnemonic: 't', label: 'Terminal' },
  { id: 'git', mnemonic: 'g', label: 'Git' },
]

/** An action with its id's prefix as its group, unless `rest` says otherwise. */
function qa(id: string, label: string, rest: Partial<QuickAction> = {}): QuickAction {
  return { id, label, group: id.split('.')[0], run: vi.fn(), ...rest }
}

function makeActions(): QuickAction[] {
  return [
    qa('terminal.split', 'Split right', { mnemonic: 'd', shortcut: '⌘D' }),
    qa('terminal.split-down', 'Split down', { mnemonic: 'D', shortcut: '⌘⇧D' }),
    qa('git.push', 'Push', { mnemonic: 'p' }),
    qa('git.pull', 'Pull', { mnemonic: 'l', disabledReason: 'No repository focused' }),
    qa('top.home', 'Home', { mnemonic: 'h', shortcut: '⌘`' }),
    // Legitimately mnemonic-less: a direct-shortcut-only action (e.g. Toggle
    // log window) or a dynamically surfaced one (e.g. a per-notification
    // action) never gets a letter.
    qa('top.no-mnemonic', 'Toggle log window', { shortcut: '⌘⇧L' }),
  ]
}

let onRun: Mock<(action: QuickAction) => void>
let onTogglePin: Mock<(id: string) => void>
let onClose: Mock<() => void>

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
    renderPanel()
    const pushRow = screen.getByText('Push').closest('.qa-row')!
    expect(pushRow.querySelector('.qa-pin-indicator')).toBeTruthy()
    const splitRow = screen.getByText('Split right').closest('.qa-row')!
    expect(splitRow.querySelector('.qa-pin-indicator')).toBeNull()
  })
})

describe('QuickActions — top level — omits the context section when there is no context group', () => {
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
})

describe('QuickActions — search mode — switches to search when searchSignal increments', () => {
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
})

describe('QuickActions — search mode — puts the highlight back on the first match when the query changes', () => {
  it('puts the highlight back on the first match when the query changes', () => {
    renderPanel()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p' } })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'split' } })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split-down' }))
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
    renderPanel()
    pressOutside(screen.getByRole('dialog', { name: 'Quick actions' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on a close request that is not Escape, such as a back gesture', () => {
    renderPanel()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when the panel itself is clicked', () => {
    const { container } = renderPanel()
    const panel = container.querySelector('.qa-panel')!
    fireEvent.mouseDown(panel)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('QuickActions — rows with no mnemonic', () => {
  it('still reserves the key column, so the label is not squeezed into a 24px cell', () => {
    // `.qa-row` is `display: grid; grid-template-columns: 24px 1fr auto`. When
    // renderKeyLabel returned null for an empty mnemonic, the <li> had only
    // two children — the label landed in the 24px column and clipped to a
    // single letter ("T…"), and the shortcut inherited the 1fr column meant
    // for the label. Every row must render three grid children regardless.
    renderPanel()
    const row = screen.getByText('Toggle log window').closest('.qa-row')!
    expect(row.children).toHaveLength(3)
  })
})

describe('QuickActions — focus', () => {
  it('moves focus into the panel on mount, so a focused element underneath cannot swallow Escape first', () => {
    // A focused element that stops propagation on keydown (like xterm's textarea,
    // which xterm attaches its own capture-phase Escape handler to) would
    // otherwise prevent the panel's window-level Escape listener from ever
    // firing — the panel closing only worked by coincidence of nothing else
    // being focused. Regression for that: opening the panel while a terminal
    // has focus must move focus in, exactly as every other dialog in the app does.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    const { container } = renderPanel()
    const panel = container.querySelector('.qa-panel')!
    expect(panel.contains(document.activeElement)).toBe(true)

    outside.remove()
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

const pressInPanel = (k: string, mods: Partial<KeyboardEventInit> = {}): void => {
  fireEvent.keyDown(window, { key: k, ...mods })
}
const ranActionIds = (): string[] => onRun.mock.calls.map(([action]) => action.id)

describe('QuickActions — group mode keys', () => {
  it('moves through the group with the arrows and runs the highlighted action on Enter', () => {
    renderPanel()
    pressInPanel('t')
    pressInPanel('ArrowDown')
    pressInPanel('ArrowDown')
    pressInPanel('Enter')
    pressInPanel('ArrowUp')
    pressInPanel('Enter')
    // The second ArrowDown stops at the last of the two.
    expect(ranActionIds()).toEqual(['terminal.split-down', 'terminal.split'])
  })

  it('goes to search on "/"', () => {
    renderPanel()
    pressInPanel('t')
    pressInPanel('/')
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('ignores a letter no action has, and keys with a modifier', () => {
    renderPanel()
    pressInPanel('t')
    pressInPanel('z')
    pressInPanel('d', { altKey: true })
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByText('Split right')).toBeTruthy()
  })
})

describe('QuickActions — top level keys and pointer', () => {
  it('runs a Go action by its letter, and ignores a letter nothing has', () => {
    renderPanel()
    pressInPanel('z')
    expect(onRun).not.toHaveBeenCalled()
    pressInPanel('h')
    expect(ranActionIds()).toEqual(['top.home'])
  })

  it('opens a group from its row with Enter', () => {
    renderPanel()
    // Push and Split right (pinned and recent), then the Terminal group.
    pressInPanel('ArrowDown')
    pressInPanel('ArrowDown')
    pressInPanel('Enter')
    expect(screen.getByRole('listbox', { name: 'Terminal' })).toBeTruthy()
  })

  it('opens a group, and runs an action, with the pointer', () => {
    renderPanel()
    fireEvent.mouseDown(screen.getByText('Git').closest('.qa-row')!)
    fireEvent.mouseEnter(screen.getByText('Push').closest('.qa-row')!)
    fireEvent.mouseDown(screen.getByText('Push').closest('.qa-row')!)
    expect(ranActionIds()).toEqual(['git.push'])
  })

  it('does not run a row when its pin button is pressed', () => {
    renderPanel()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Unpin Push' }))
    expect(onRun).not.toHaveBeenCalled()
  })
})

describe('QuickActions — top level keys and pointer — pins nothing when cmd+. lands on a group row', () => {
  it('pins nothing when cmd+. lands on a group row', () => {
    renderPanel({ pinned: [], recent: [] })
    pressInPanel('.', { metaKey: true })
    expect(onTogglePin).not.toHaveBeenCalled()
  })
})

describe('QuickActions — search keys', () => {
  it('moves back up the results with ArrowUp', () => {
    renderPanel()
    pressInPanel('/')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'split' } })
    pressInPanel('ArrowDown')
    pressInPanel('ArrowUp')
    pressInPanel('Enter')
    expect(ranActionIds()).toEqual(['terminal.split'])
  })

  it('keeps searching on Backspace while there is a query', () => {
    renderPanel()
    pressInPanel('/')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p' } })
    pressInPanel('Backspace')
    expect(screen.getByRole('combobox')).toBeTruthy()
  })
})

describe('QuickActions — rows from a group it does not list', () => {
  const orphan = qa('gone.thing', 'Orphan', {
    mnemonic: 'o',
    description: 'From an extension that left',
  })

  it('labels a pinned row by its own letter when its group is gone, with its description', () => {
    renderPanel({ pinned: [orphan], recent: [] })
    const row = screen.getByText('Orphan').closest('.qa-row')!
    expect(row.querySelector('.qa-key')!.textContent).toBe('o')
    expect(row.querySelector('.qa-row__group')).toBeNull()
    expect(screen.getByText('From an extension that left')).toBeTruthy()
  })

  it('labels a pinned Go action by its own letter', () => {
    const home = makeActions().find((a) => a.id === 'top.home')!
    renderPanel({ pinned: [home], recent: [] })
    const rows = screen.getAllByText('Home').map((el) => el.closest('.qa-row')!)
    expect(rows[0].querySelector('.qa-key')!.textContent).toBe('h')
  })

  it('draws no context section for a context group it does not have', () => {
    renderPanel({ contextGroupId: 'gone' })
    expect(screen.queryByText(/· here/)).toBeNull()
  })
})
