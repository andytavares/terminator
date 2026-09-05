import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  const direct = [...el.children].filter((c) => !c.classList.contains('branch-row__hover'))
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

  it('distinguishes the four states by shape', () => {
    const shapes = (['awaiting-input', 'working', 'idle', 'exited'] as const).map((state) => {
      const { container, unmount } = renderRow({ state })
      const html = container.querySelector('.branch-row__gutter svg')!.innerHTML
      unmount()
      return html
    })
    expect(new Set(shapes).size).toBe(4)
  })

  it('never colours the state glyph', () => {
    const { container } = renderRow({ state: 'awaiting-input' })
    const svg = container.querySelector<SVGElement>('.branch-row__gutter svg')!
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('style')).toBeNull()
  })

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

  it('shows neither for a branch with no terminals', () => {
    const { container } = renderRow({ stateCount: 0, sessionCount: 0, lastActivityAt: null })
    expect(container.querySelector('.branch-row__age')).toBeNull()
    expect(container.querySelector('.branch-row__count')).toBeNull()
  })

  // FR-026.
  it('draws no more than six elements at rest', () => {
    const { container } = renderRow(
      { isWorktree: false, state: 'awaiting-input', stateCount: 3 },
      { issueKey: 'TAV-14', changeStats: { added: 1, removed: 1, files: 1 } }
    )
    expect(restingElements(container)).toBeLessThanOrEqual(6)
  })

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

  describe('interaction', () => {
    it('selects on click', () => {
      const onSelect = vi.fn()
      const { container } = renderRow({}, { onSelect })
      fireEvent.click(container.querySelector('.branch-row')!)
      expect(onSelect).toHaveBeenCalled()
    })

    it.each(['Enter', ' '])('selects on %s', (key) => {
      const onSelect = vi.fn()
      const { container } = renderRow({}, { onSelect })
      fireEvent.keyDown(container.querySelector('.branch-row')!, { key })
      expect(onSelect).toHaveBeenCalled()
    })

    it('marks the selected row without using the repo colour', () => {
      const { container } = renderRow({}, { selected: true })
      const el = container.querySelector('.branch-row')!
      expect(el.classList.contains('branch-row--selected')).toBe(true)
      expect(el.getAttribute('aria-current')).toBe('true')
    })

    it('offers a new terminal on hover without shifting the row', () => {
      const onAddTerminal = vi.fn()
      renderRow({}, { onAddTerminal })
      fireEvent.click(screen.getByRole('button', { name: /new terminal in 034-declutter/i }))
      expect(onAddTerminal).toHaveBeenCalled()
    })

    it('does not select the branch when the add button is used', () => {
      const onSelect = vi.fn()
      const onAddTerminal = vi.fn()
      renderRow({}, { onSelect, onAddTerminal })
      fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('the context menu', () => {
    it('offers rename only where the branch has no branch to be named by', () => {
      const { container } = renderRow({}, { onRename: vi.fn() })
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      expect(screen.getByText('Rename')).toBeTruthy()
    })

    it('offers no rename for a branch named by its branch', () => {
      const { container } = renderRow({}, { onRemove: vi.fn() })
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      expect(screen.queryByText('Rename')).toBeNull()
    })

    it('renames through the callback', () => {
      const onRename = vi.fn()
      const { container } = renderRow({}, { onRename })
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      fireEvent.click(screen.getByText('Rename'))
      const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
      fireEvent.change(input, { target: { value: 'renamed' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRename).toHaveBeenCalledWith('renamed')
    })

    it('abandons a rename on Escape', () => {
      const onRename = vi.fn()
      const { container } = renderRow({}, { onRename })
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      fireEvent.click(screen.getByText('Rename'))
      const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
      fireEvent.change(input, { target: { value: 'nope' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(onRename).not.toHaveBeenCalled()
    })

    it('carries the issue actions', () => {
      const { container } = renderRow(
        {},
        { issueActions: { issueKey: 'TAV-14', onLinkIssue: vi.fn(), onOpenIssue: vi.fn() } }
      )
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      expect(screen.getByText('Open TAV-14 in tracker')).toBeTruthy()
    })

    it('removes through the callback', () => {
      const onRemove = vi.fn()
      const { container } = renderRow({}, { onRemove })
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      fireEvent.click(screen.getByText('Remove branch'))
      expect(onRemove).toHaveBeenCalled()
    })

    it('opens no menu when there is nothing to put in it', () => {
      const { container } = renderRow()
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      expect(document.querySelector('.ctx-menu')).toBeNull()
    })
  })
})

describe('BranchRow — the issue key keeps its behaviour without its badge', () => {
  it('opens the issue drawer from the key', () => {
    const onIssueClick = vi.fn()
    renderRow({}, { issueKey: 'TAV-14', onIssueClick })
    fireEvent.click(screen.getByRole('button', { name: 'Open TAV-14' }))
    expect(onIssueClick).toHaveBeenCalled()
  })

  it('does not also select the branch when the key is clicked', () => {
    const onSelect = vi.fn()
    renderRow({}, { issueKey: 'TAV-14', onIssueClick: vi.fn(), onSelect })
    fireEvent.click(screen.getByRole('button', { name: 'Open TAV-14' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('draws the key as inert text when there is nothing to open', () => {
    const { container } = renderRow({}, { issueKey: 'TAV-14' })
    expect(container.querySelector('.branch-row__issue')!.tagName).toBe('SPAN')
  })
})

describe('BranchRow — repo actions are reachable from the row', () => {
  // Under "no grouping" there is no repo header to host them, and a contributed
  // surface has to be reachable in every grouping.
  const repoActions = [{ id: 'git', label: 'Git', onSelect: vi.fn() }]

  it('lists them in the row menu', () => {
    const { container } = renderRow({}, { repoActions })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(screen.getByText('Git')).toBeTruthy()
  })

  it('fires one and closes the menu', () => {
    const onSelect = vi.fn()
    const { container } = renderRow({}, { repoActions: [{ id: 'git', label: 'Git', onSelect }] })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText('Git'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('opens a menu for them even when nothing else would', () => {
    const { container } = renderRow({}, { repoActions })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
  })
})

describe('BranchRow — renaming', () => {
  it('commits on blur', () => {
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    fireEvent.change(input, { target: { value: 'blurred' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('blurred')
  })

  it('ignores an empty name', () => {
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('ignores a name that did not change', () => {
    const onRename = vi.fn()
    const { container } = renderRow({}, { onRename })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.blur(container.querySelector('.branch-row__rename')!)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('does not select the branch while typing in the editor', () => {
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onRename: vi.fn(), onSelect })
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.click(container.querySelector('.branch-row__rename')!)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
