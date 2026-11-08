import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchRow } from '../../../../src/renderer/components/sidebar/BranchRow'
import type { BranchRow as BranchRowData } from '../../../../src/renderer/sidebar/branch-rows'

const NOW = 1_000_000_000

function row(patch: Partial<BranchRowData> = {}): BranchRowData {
  return {
    projectId: 'p1',
    label: '034-declutter',
    isWorktree: true,
    state: 'idle',
    stateCount: 1,
    sessionCount: 1,
    terminals: [],
    lastActivityAt: NOW,
    workspaceId: 'ws-1',
    ...patch,
  }
}

const renderRow = (patch: Partial<BranchRowData> = {}, props: Record<string, unknown> = {}) =>
  render(
    <BranchRow
      row={row(patch)}
      selected={false}
      colour="#5c6bc0"
      now={NOW}
      onSelect={vi.fn()}
      {...props}
    />
  )

/** What the row draws at rest, excluding the rail, which is identity not fact. */
const restingElements = (container: HTMLElement): number => {
  const el = container.querySelector('.branch-row')!
  // The hover group is not at rest, and the disclosure is structure rather
  // than a fact about the branch — it says where the row sits in the tree, the
  // same way the repo header's chevron does.
  const direct = [...el.children].filter(
    (c) =>
      !c.classList.contains('branch-row__hover') && !c.classList.contains('branch-row__disclosure')
  )
  const meta = el.querySelector('.branch-row__meta')
  const metaCount = meta ? meta.children.length : 0
  const kindEmpty = el.querySelector('.branch-row__kind')!.children.length === 0 ? 1 : 0
  return direct.length - 1 - kindEmpty + metaCount
}

describe('BranchRow', () => {
  it('names the branch in the machine face', () => {
    const { container } = renderRow()
    const name = container.querySelector('.branch-row__name')!
    expect(name.textContent).toBe('034-declutter')
  })

  it.each([
    ['awaiting-input', 'Waiting on you'],
    ['working', 'Running'],
    ['idle', 'Idle'],
    ['exited', 'Exited'],
  ] as const)('shows the %s state and names it for a reader', (state, label) => {
    const { container } = renderRow({ state })
    expect(container.querySelector('.branch-row__gutter svg')!.getAttribute('data-state')).toBe(
      state
    )
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(label)
  })
})

describe('BranchRow — marks a plain checkout and leaves a worktree unmarked', () => {
  // FR-028. One element says which kind, and it marks the exception.
  it('marks a plain checkout and leaves a worktree unmarked', () => {
    const { container: plain } = renderRow({ isWorktree: false })
    expect(plain.querySelector('.branch-row__kind svg')).toBeTruthy()
    const { container: tree } = renderRow({ isWorktree: true })
    expect(tree.querySelector('.branch-row__kind svg')).toBeNull()
  })

  it('draws no separate worktree word anywhere', () => {
    const { container } = renderRow({ isWorktree: true })
    expect(container.textContent).not.toMatch(/worktree/i)
  })
})

describe('BranchRow — draws a linked issue key as plain text', () => {
  // FR-029.
  it('draws a linked issue key as plain text', () => {
    const { container } = renderRow({}, { issueKey: 'TAV-14' })
    const issue = container.querySelector('.branch-row__issue')!
    expect(issue.textContent).toBe('TAV-14')
    expect(issue.tagName).toBe('SPAN')
    // No badge, no state dot: the key alone. That it also has no border is a
    // claim about the stylesheet, which jsdom cannot resolve — it is asserted
    // by rendering in sidebar-workspace-tint.spec.ts instead.
    expect(issue.querySelector('span, em, i')).toBeNull()
  })

  it('draws nothing for a branch with no issue', () => {
    const { container } = renderRow()
    expect(container.querySelector('.branch-row__issue')).toBeNull()
  })

  it('draws change counts when git has answered', () => {
    const { container } = renderRow({}, { changeStats: { added: 412, removed: 96, files: 3 } })
    expect(container.querySelector('.branch-row__stats')!.textContent).toContain('+412')
    expect(container.querySelector('.branch-row__stats')!.textContent).toContain('96')
  })

  it.each([
    ['not asked yet', undefined],
    ['git could not answer', null],
    ['nothing changed', { added: 0, removed: 0, files: 0 }],
  ])('draws no change counts when %s', (_name, changeStats) => {
    const { container } = renderRow({}, { changeStats })
    expect(container.querySelector('.branch-row__stats')).toBeNull()
  })
})

describe('BranchRow — counts what shares the row state, once there is more than one', () => {
  // The count agrees with the glyph rather than totalling the branch.
  it('counts what shares the row state, once there is more than one', () => {
    const { container } = renderRow({ state: 'awaiting-input', stateCount: 2, sessionCount: 5 })
    expect(container.querySelector('.branch-row__count')!.textContent).toBe('2')
    expect(container.querySelector('.branch-row__age')).toBeNull()
  })

  it('shows an age instead when only one terminal shares the state', () => {
    const { container } = renderRow({ stateCount: 1, lastActivityAt: NOW - 5 * 60_000 })
    expect(container.querySelector('.branch-row__age')!.textContent).toBe('5m')
    expect(container.querySelector('.branch-row__count')).toBeNull()
  })

  it('states neither a count nor an age for a branch with no terminals', () => {
    // The box stays — it is the column every count in the sidebar shares, and
    // dropping it would let the row's hover control sit where the numbers are
    // — but it says nothing.
    const { container } = renderRow({ stateCount: 0, sessionCount: 0, lastActivityAt: null })
    expect(container.querySelector('.branch-row__count')).toBeNull()
    expect(container.querySelector('.branch-row__age')!.textContent).toBe('')
  })

  // FR-026.
  it('draws no more than six elements at rest', () => {
    const { container } = renderRow(
      { isWorktree: false, state: 'awaiting-input', stateCount: 3 },
      { issueKey: 'TAV-14', changeStats: { added: 1, removed: 1, files: 1 } }
    )
    expect(restingElements(container)).toBeLessThanOrEqual(6)
  })
})

describe('BranchRow — carries the repo colour as one rail variable, not as a background', () => {
  it('carries the repo colour as one rail variable, not as a background', () => {
    const { container } = renderRow()
    const el = container.querySelector<HTMLElement>('.branch-row')!
    expect(el.style.getPropertyValue('--ws-color')).toBe('#5c6bc0')
    expect(el.style.background).toBe('')
  })

  it('draws no rail for a branch with no repo colour', () => {
    const { container } = renderRow({}, { colour: undefined })
    expect(
      container.querySelector<HTMLElement>('.branch-row')!.style.getPropertyValue('--ws-color')
    ).toBe('')
  })
})

describe('BranchRow — interaction', () => {
  it('selects on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onSelect })
    await user.click(container.querySelector('.branch-row')!)
    expect(onSelect).toHaveBeenCalled()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('selects on %s', async (_name, keys) => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onSelect })
    const row = container.querySelector<HTMLElement>('.branch-row')!
    row.focus()
    expect(document.activeElement).toBe(row)
    await user.keyboard(keys)
    expect(onSelect).toHaveBeenCalled()
  })

  it('marks the selected row without using the repo colour', () => {
    const { container } = renderRow({}, { selected: true })
    const el = container.querySelector('.branch-row')!
    expect(el.classList.contains('branch-row--selected')).toBe(true)
    expect(el.getAttribute('aria-current')).toBe('true')
  })
})

describe('BranchRow — the add button', () => {
  it('starts a new terminal in the branch from its add button', async () => {
    const user = userEvent.setup()
    const onAddTerminal = vi.fn()
    renderRow({}, { onAddTerminal })
    await user.click(screen.getByRole('button', { name: /new terminal in 034-declutter/i }))
    expect(onAddTerminal).toHaveBeenCalled()
  })

  it('does not select the branch when the add button is used', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onAddTerminal = vi.fn()
    renderRow({}, { onSelect, onAddTerminal })
    await user.click(screen.getByRole('button', { name: /new terminal/i }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('BranchRow — the context menu', () => {
  it('offers rename only where the branch has no branch to be named by', async () => {
    const user = userEvent.setup()
    const { container } = renderRow({}, { onRename: vi.fn() })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.getByText('Rename')).toBeTruthy()
  })

  it('offers no rename for a branch named by its branch', async () => {
    const user = userEvent.setup()
    const { container } = renderRow({}, { onRemove: vi.fn() })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.queryByText('Rename')).toBeNull()
  })

  it('renames through the callback', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    await user.clear(input)
    await user.type(input, 'renamed')
    await user.keyboard('{Enter}')
    expect(onRename).toHaveBeenCalledWith('renamed')
  })
})

describe('BranchRow — the context menu — abandons a rename on Escape', () => {
  it('abandons a rename on Escape', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    await user.clear(input)
    await user.type(input, 'nope')
    await user.keyboard('{Escape}')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('carries the issue actions', async () => {
    const user = userEvent.setup()
    const { container } = renderRow(
      {},
      { issueActions: { issueKey: 'TAV-14', onLinkIssue: vi.fn(), onOpenIssue: vi.fn() } }
    )
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.getByText('Open TAV-14 in tracker')).toBeTruthy()
  })
})

describe('BranchRow — the context menu — removing', () => {
  it('removes through the callback', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const { container } = renderRow({}, { onRemove })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Remove branch'))
    expect(onRemove).toHaveBeenCalled()
  })
})

describe('BranchRow — the context menu — opens no menu when there is nothing to put in it', () => {
  it('opens no menu when there is nothing to put in it', async () => {
    const user = userEvent.setup()
    const { container } = renderRow()
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('BranchRow — the issue key keeps its behaviour without its badge', () => {
  it('opens the issue drawer from the key', async () => {
    const user = userEvent.setup()
    const onIssueClick = vi.fn()
    renderRow({}, { issueKey: 'TAV-14', onIssueClick })
    await user.click(screen.getByRole('button', { name: 'Open TAV-14' }))
    expect(onIssueClick).toHaveBeenCalled()
  })

  it('does not also select the branch when the key is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderRow({}, { issueKey: 'TAV-14', onIssueClick: vi.fn(), onSelect })
    await user.click(screen.getByRole('button', { name: 'Open TAV-14' }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('BranchRow — repo actions are reachable from the row', () => {
  // Under "no grouping" there is no repo header to host them, and a contributed
  // surface has to be reachable in every grouping.
  const repoActions = [{ id: 'git', label: 'Git', onSelect: vi.fn() }]

  it('lists them in the row menu', async () => {
    const user = userEvent.setup()
    const { container } = renderRow({}, { repoActions })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.getByText('Git')).toBeTruthy()
  })

  it('fires one and closes the menu', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { container } = renderRow({}, { repoActions: [{ id: 'git', label: 'Git', onSelect }] })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByRole('menuitem', { name: 'Git' }))
    expect(onSelect).toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Git' })).toBeNull()
  })
})

describe('BranchRow — renaming', () => {
  it('commits on blur', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    await user.clear(input)
    await user.type(input, 'blurred')
    await user.tab()
    expect(onRename).toHaveBeenCalledWith('blurred')
  })

  it('ignores an empty name', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    await user.clear(input)
    await user.type(input, '   ')
    await user.tab()
    expect(onRename).not.toHaveBeenCalled()
  })
})

describe('BranchRow — renaming — ignores a name that did not change', () => {
  it('ignores a name that did not change', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Rename'))
    expect(document.activeElement).toBe(container.querySelector('.branch-row__rename'))
    await user.tab()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('does not select the branch while typing in the editor', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onRename: vi.fn(), onSelect })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Rename'))
    await user.click(container.querySelector('.branch-row__rename')!)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('BranchRow — open in editor', () => {
  it('offers the action named after the editor that will run', async () => {
    const user = userEvent.setup()
    const { container } = renderRow({}, { onOpenInEditor: vi.fn(), editorName: 'Cursor' })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.getByText('Open in Cursor')).toBeTruthy()
  })

  it('falls back to a generic label when the editor is not known yet', async () => {
    const user = userEvent.setup()
    const { container } = renderRow({}, { onOpenInEditor: vi.fn() })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.getByText('Open in editor')).toBeTruthy()
  })

  it('opens the branch folder and closes the menu', async () => {
    const user = userEvent.setup()
    const onOpenInEditor = vi.fn()
    const { container } = renderRow({}, { onOpenInEditor, editorName: 'Cursor' })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Open in Cursor'))
    expect(onOpenInEditor).toHaveBeenCalled()
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  // Remote mode omits the editor API entirely, so the handler is absent and the
  // item must not appear — an action that cannot work should not be offered.
  it('offers nothing when there is no way to open an editor', async () => {
    const user = userEvent.setup()
    const { container } = renderRow({}, { onRemove: vi.fn() })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    expect(screen.queryByText(/Open in/)).toBeNull()
  })
})

describe('BranchRow — open in editor — does not also select the branch', () => {
  it('does not also select the branch', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onOpenInEditor: vi.fn(), onSelect })
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Open in editor'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('BranchRow — open in editor — session issue keys', () => {
  it('shows a session key when the branch has no link of its own', () => {
    const { container } = renderRow({}, { sessionIssueKeys: ['ENG-7'] })
    const key = container.querySelector('.branch-row__issue')!
    expect(key.textContent).toBe('ENG-7')
    expect(key.tagName).toBe('SPAN')
  })

  it('keeps the branch key first and counts the other keys its terminals carry', () => {
    const { container } = renderRow(
      {},
      {
        issueKey: 'TAV-14',
        onIssueClick: vi.fn(),
        sessionIssueKeys: ['ENG-7', 'TAV-14', 'ENG-8'],
      }
    )
    const key = container.querySelector('.branch-row__issue')!
    expect(key.textContent).toBe('TAV-14 +2')
    expect(key.getAttribute('title')).toBe('TAV-14, ENG-7, ENG-8')
    expect(container.querySelectorAll('.branch-row__issue')).toHaveLength(1)
  })

  it('draws no key when neither the branch nor a terminal is linked', () => {
    const { container } = renderRow({}, { sessionIssueKeys: [] })
    expect(container.querySelector('.branch-row__issue')).toBeNull()
  })
})

const TERMINAL = {
  sessionId: 'ses-1',
  title: 'Terminal 1',
  state: 'idle' as const,
  bellCount: 0,
  panes: [],
  workItem: null,
}

describe('BranchRow — the disclosure for its terminals', () => {
  it('draws an empty slot rather than a button when there are no terminals', () => {
    const { container } = renderRow({}, { onToggleExpanded: vi.fn(), expanded: false })
    expect(container.querySelector('.branch-row__disclosure--empty')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /terminals in/ })).toBeNull()
  })

  it('shows or hides them without selecting the branch', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onToggleExpanded = vi.fn()
    renderRow({ terminals: [TERMINAL] }, { onSelect, onToggleExpanded, expanded: false })
    await user.click(screen.getByRole('button', { name: 'Show terminals in 034-declutter' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('says it hides them once expanded', () => {
    renderRow({ terminals: [TERMINAL] }, { onToggleExpanded: vi.fn(), expanded: true })
    const button = screen.getByRole('button', { name: 'Hide terminals in 034-declutter' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('BranchRow — the menu and the keyboard', () => {
  it('closes the menu before running an issue action', async () => {
    const user = userEvent.setup()
    const onOpenIssue = vi.fn()
    const { container } = renderRow(
      {},
      { issueActions: { issueKey: 'TAV-14', onLinkIssue: vi.fn(), onOpenIssue } }
    )
    await user.pointer({ keys: '[MouseRight]', target: container.querySelector('.branch-row')! })
    await user.click(screen.getByText('Open TAV-14 in tracker'))
    expect(onOpenIssue).toHaveBeenCalledOnce()
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('ignores keys other than Enter and Space', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onSelect })
    const row = container.querySelector<HTMLElement>('.branch-row')!
    row.focus()
    expect(document.activeElement).toBe(row)
    await user.keyboard('a')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
