import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickActions } from '../../../../src/components/QuickActions'
import type { QuickAction, QuickActionGroup } from '../../../../src/quick-actions/types'

vi.mock('../../../../src/components/QuickActions.css', () => ({}))

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

/** The rows (options) that show `label`, in the order the panel lists them. */
const rowsWith = (label: string): HTMLElement[] =>
  screen.getAllByRole('option').filter((row) => within(row).queryByText(label) !== null)

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
    expect(within(rowsWith('Push')[0]).getByRole('img', { name: 'Pinned' })).toBeTruthy()
    expect(within(rowsWith('Split right')[0]).queryByRole('img', { name: 'Pinned' })).toBeNull()
  })
})

describe('QuickActions — top level — omits the context section when there is no context group', () => {
  it.each([
    ['no context group', null],
    ['a context group it does not list', 'gone'],
  ])('omits the context section when there is %s', (_case, contextGroupId) => {
    renderPanel({ contextGroupId })
    expect(screen.queryByText(/· here/)).toBeNull()
  })

  it('renders a context section first, and ranks its group first among Groups', () => {
    renderPanel({ contextGroupId: 'git', contextLabel: 'in Git' })
    expect(screen.getByText('Git · here')).toBeTruthy()
    expect(screen.getByText('in Git')).toBeTruthy()
    // orderGroups puts the context group first.
    const groupOptions = within(screen.getByRole('listbox', { name: 'Groups' })).getAllByRole(
      'option'
    )
    expect(groupOptions.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Git'),
      expect.stringContaining('Terminal'),
    ])
  })
})

describe('QuickActions — group mode', () => {
  it('enters a group by its mnemonic and runs an action inside it', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('t')
    expect(screen.getByText('Split right')).toBeTruthy()
    await user.keyboard('d')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split' }))
  })

  it('is case-sensitive: "D" runs a different action than "d"', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('t')
    await user.keyboard('D')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split-down' }))
    expect(onRun).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split' }))
  })

  it('goes back to top level on Backspace', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('t')
    expect(screen.queryByText('Groups')).toBeNull()
    await user.keyboard('{Backspace}')
    expect(screen.getByText('Groups')).toBeTruthy()
  })
})

describe('QuickActions — group mode — disabled actions', () => {
  it('never runs a disabled action, and shows its reason in the footer status region', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('g')
    await user.keyboard('l')
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('No repository focused')
  })
})

describe('QuickActions — search mode', () => {
  it('switches to search on "/" and filters by typing', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    const input = screen.getByRole('combobox')
    await user.clear(input)
    await user.type(input, 'push')
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

  it('runs the first match on Enter', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    await user.type(screen.getByRole('combobox'), 'push')
    await user.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'git.push' }))
  })
})

describe('QuickActions — search mode — puts the highlight back on the first match when the query changes', () => {
  it('puts the highlight back on the first match when the query changes', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    await user.type(screen.getByRole('combobox'), 'p')
    await user.keyboard('{ArrowDown}')
    await user.type(screen.getByRole('combobox'), 'ush')
    await user.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'git.push' }))
  })

  it('goes back to top level on Backspace when the query is empty', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    await user.keyboard('{Backspace}')
    expect(screen.getByText('Groups')).toBeTruthy()
  })

  it('navigates results with arrow keys', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    await user.type(screen.getByRole('combobox'), 'split')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split-down' }))
  })
})

describe('QuickActions — pinning', () => {
  it('toggles the pin on the highlighted row with cmd+.', async () => {
    const user = userEvent.setup()
    renderPanel()
    // Highlight starts on the first pinned/recent row: Push.
    await user.keyboard('{Meta>}.{/Meta}')
    expect(onTogglePin).toHaveBeenCalledWith('git.push')
  })

  it.each([
    ['Unpin Push', 'git.push'],
    ['Pin Split right', 'terminal.split'],
  ])('names a row\'s hover pin button "%s", and it toggles %s', async (name, actionId) => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name }))
    expect(onTogglePin).toHaveBeenCalledWith(actionId)
  })
})

describe('QuickActions — closing', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
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
    const [row] = rowsWith('Toggle log window')
    // eslint-disable-next-line testing-library/no-node-access -- the claim is the row's three grid cells; layout has no query
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
    expect(outside.matches(':focus')).toBe(true)

    renderPanel()
    const panel = screen.getByRole('dialog', { name: 'Quick actions' })
    expect(panel.matches(':focus-within')).toBe(true)

    outside.remove()
  })
})

describe('QuickActions — arrow navigation', () => {
  it('moves the highlight and runs the highlighted row on Enter', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal.split' }))
  })

  it('does not move the highlight past the first row on ArrowUp', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'git.push' }))
  })
})

const ranActionIds = (): string[] => onRun.mock.calls.map(([action]) => action.id)

describe('QuickActions — group mode keys', () => {
  it('moves through the group with the arrows and runs the highlighted action on Enter', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('t')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')
    // The second ArrowDown stops at the last of the two.
    expect(ranActionIds()).toEqual(['terminal.split-down', 'terminal.split'])
  })

  it('goes to search on "/"', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('t')
    await user.keyboard('/')
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('ignores a letter no action has, and keys with a modifier', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('t')
    await user.keyboard('z')
    await user.keyboard('{Alt>}d{/Alt}')
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByText('Split right')).toBeTruthy()
  })
})

describe('QuickActions — top level keys and pointer', () => {
  it('runs a Go action by its letter, and ignores a letter nothing has', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('z')
    expect(onRun).not.toHaveBeenCalled()
    await user.keyboard('h')
    expect(ranActionIds()).toEqual(['top.home'])
  })

  it('opens a group from its row with Enter', async () => {
    const user = userEvent.setup()
    renderPanel()
    // Push and Split right (pinned and recent), then the Terminal group.
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('listbox', { name: 'Terminal' })).toBeTruthy()
  })
})

describe('QuickActions — pointer', () => {
  it('opens a group, and runs an action, with the pointer', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(rowsWith('Git')[0])
    await user.hover(rowsWith('Push')[0])
    await user.click(rowsWith('Push')[0])
    expect(ranActionIds()).toEqual(['git.push'])
  })

  it('does not run a row when its pin button is pressed', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Unpin Push' }))
    expect(onRun).not.toHaveBeenCalled()
  })
})

describe('QuickActions — top level keys and pointer — pins nothing when cmd+. lands on a group row', () => {
  it('pins nothing when cmd+. lands on a group row', async () => {
    const user = userEvent.setup()
    renderPanel({ pinned: [], recent: [] })
    await user.keyboard('{Meta>}.{/Meta}')
    expect(onTogglePin).not.toHaveBeenCalled()
  })
})

describe('QuickActions — search keys', () => {
  it('moves back up the results with ArrowUp', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    await user.type(screen.getByRole('combobox'), 'split')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')
    expect(ranActionIds()).toEqual(['terminal.split'])
  })

  it('keeps searching on Backspace while there is a query', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.keyboard('/')
    await user.type(screen.getByRole('combobox'), 'p')
    await user.keyboard('{Backspace}')
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
    const [row] = rowsWith('Orphan')
    expect(within(row).getByText('o')).toBeTruthy()
    expect(within(row).queryByText(/ ·$/)).toBeNull()
    expect(screen.getByText('From an extension that left')).toBeTruthy()
  })

  it('labels a pinned Go action by its own letter', () => {
    const home = makeActions().find((a) => a.id === 'top.home')!
    renderPanel({ pinned: [home], recent: [] })
    expect(within(rowsWith('Home')[0]).getByText('h')).toBeTruthy()
  })
})
