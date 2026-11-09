import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoHeader } from '../../../../src/components/sidebar/RepoHeader'
import type { RepoGroup } from '../../../../src/sidebar/branch-rows'

function group(patch: Partial<RepoGroup> = {}): RepoGroup {
  return {
    workspaceId: 'ws-1',
    label: 'terminator',
    color: '#5c6bc0',
    folderPath: '/repos/terminator',
    branches: [],
    branchCount: 4,
    needsYou: false,
    ...patch,
  }
}

const renderHeader = (patch: Partial<RepoGroup> = {}, props: Record<string, unknown> = {}) =>
  render(
    <RepoHeader group={group(patch)} collapsed={false} onToggleCollapse={vi.fn()} {...props} />
  )

/**
 * Drawn at rest, excluding the colour swatch (identity, not a fact) and the
 * disclosure chevron (structure, not content).
 *
 * The chevron moved out of the hover group and to the head of the row so that
 * a header says whether it is collapsed without being pointed at — which is
 * the first question it has to answer. It is not one of the facts this budget
 * is counting.
 */
/* eslint-disable testing-library/no-node-access -- FR-027 counts drawn elements, a layout claim no query can see */
const restingElements = (container: HTMLElement): number =>
  [...container.querySelector('.repo-header')!.children].filter(
    (c) =>
      !c.classList.contains('repo-header__hover') &&
      !c.classList.contains('repo-header__swatch') &&
      !c.classList.contains('repo-header__chevron')
  ).length
/* eslint-enable testing-library/no-node-access */

/** The header row itself, apart from the buttons inside it. */
const header = (): HTMLElement => screen.getByRole('button', { name: /^terminator/ })

/** The repo name, which carries the path tooltip. */
const repoName = (): HTMLElement => screen.getByText('terminator')

describe('RepoHeader', () => {
  it('names the repo in the human face and counts its branches', () => {
    renderHeader()
    expect(repoName()).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
  })

  // FR-030. The path is available, and drawn nowhere.
  it('offers the folder path as the name tooltip rather than drawing it', () => {
    renderHeader()
    expect(repoName().getAttribute('title')).toBe('/repos/terminator')
    expect(header().textContent).not.toContain('/repos/terminator')
  })

  it('prefers the abbreviated path when it is given one', () => {
    renderHeader({}, { pathLabel: '~/repos/terminator' })
    expect(repoName().getAttribute('title')).toBe('~/repos/terminator')
  })

  /**
   * A native tooltip is drawn over whatever sits beneath it. On the whole row
   * it fired from anywhere across 300px and blanketed the branches below;
   * scoped to the name it appears where the thing it describes is.
   */
  it('does not put the tooltip on the whole row', () => {
    renderHeader({}, { pathLabel: '~/repos/terminator' })
    expect(header().getAttribute('title')).toBeNull()
  })
})

describe('RepoHeader — carries the repo colour as a swatch, not as the name colour', () => {
  // FR-043. The colour is a swatch; the name is ordinary text.
  it('carries the repo colour as a swatch, not as the name colour', () => {
    renderHeader()
    expect(header().style.getPropertyValue('--ws-color')).toBe('#5c6bc0')
    expect(screen.getByTestId('repo-swatch')).toBeTruthy()
    expect(repoName().style.color).toBe('')
  })

  it('draws no swatch for a group with no colour', () => {
    renderHeader({ color: '' })
    expect(screen.queryByTestId('repo-swatch')).toBeNull()
  })

  // FR-027.
  it.each([
    ['at rest', {}, {}],
    ['when collapsed and something is waiting', { needsYou: true }, { collapsed: true }],
  ])('draws no more than three elements %s', (_case, patch, props) => {
    const { container } = renderHeader(patch, props)
    expect(restingElements(container)).toBeLessThanOrEqual(3)
  })

  // FR-004. Collapsing a repo must not hide the one thing you needed to see.
  it('signals a waiting branch only while collapsed', () => {
    const open = renderHeader({ needsYou: true })
    expect(screen.queryByRole('img', { name: /waiting/i })).toBeNull()
    open.unmount()
    renderHeader({ needsYou: true }, { collapsed: true })
    expect(screen.getByRole('img', { name: /waiting/i })).toBeTruthy()
  })
})

describe('RepoHeader — stays quiet when collapsed with nothing waiting', () => {
  it('stays quiet when collapsed with nothing waiting', () => {
    renderHeader({ needsYou: false }, { collapsed: true })
    expect(screen.queryByRole('img', { name: /waiting/i })).toBeNull()
  })

  it('names the waiting signal for a reader', () => {
    renderHeader({ needsYou: true }, { collapsed: true })
    expect(screen.getByRole('img', { name: 'A branch here is waiting on you' })).toBeTruthy()
  })
})

describe('RepoHeader — interaction', () => {
  it('collapses on click', async () => {
    const user = userEvent.setup()
    const onToggleCollapse = vi.fn()
    renderHeader({}, { onToggleCollapse })
    await user.click(header())
    expect(onToggleCollapse).toHaveBeenCalled()
  })

  it('reports its expanded state', () => {
    renderHeader({}, { collapsed: true })
    expect(header().getAttribute('aria-expanded')).toBe('false')
  })

  // FR-005. Creating a branch moved here from an always-visible row.
  it('offers a new branch without also collapsing the repo', async () => {
    const user = userEvent.setup()
    const onAddBranch = vi.fn()
    const onToggleCollapse = vi.fn()
    renderHeader({}, { onAddBranch, onToggleCollapse })
    await user.click(screen.getByRole('button', { name: 'New branch in terminator' }))
    expect(onAddBranch).toHaveBeenCalled()
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })
})

describe('RepoHeader — interaction — hosts registered repo actions', () => {
  it('hosts registered repo actions', async () => {
    const user = userEvent.setup()
    const onSelectWorkspaceTab = vi.fn()
    renderHeader(
      {},
      {
        workspaceTabs: [{ id: 'git', label: 'Git', component: () => null }],
        onSelectWorkspaceTab,
      }
    )
    await user.click(screen.getByRole('button', { name: 'Git' }))
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('git')
  })

  it('marks the active repo action', () => {
    renderHeader(
      {},
      {
        workspaceTabs: [{ id: 'git', label: 'Git', component: () => null }],
        activeWorkspaceTabId: 'git',
      }
    )
    expect(screen.getByRole('button', { name: 'Git' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('RepoHeader — interaction — edits and removes from the context menu', () => {
  it('edits and removes from the context menu', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    renderHeader({}, { onEdit, onRemove })
    await user.pointer({ keys: '[MouseRight]', target: header() })
    await user.click(screen.getByText('Edit workspace'))
    expect(onEdit).toHaveBeenCalled()
    await user.pointer({ keys: '[MouseRight]', target: header() })
    await user.click(screen.getByText('Remove workspace'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('opens no menu when there is nothing to put in it', async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.pointer({ keys: '[MouseRight]', target: header() })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('RepoHeader — hover reveals without moving anything (FR-031)', () => {
  const tabs = [
    { id: 'a', label: 'Code Reviews', component: () => null },
    { id: 'b', label: 'SpecKit', component: () => null },
  ]

  it('keeps the branch count drawn alongside the controls, however many there are', () => {
    // A fixed reservation meant four controls overflowed leftward and painted
    // over the count. The count must survive any number of repo actions.
    renderHeader({}, { workspaceTabs: tabs, onAddBranch: vi.fn() })
    expect(screen.getByText('4')).toBeTruthy()
    expect(within(header()).getAllByRole('button')).toHaveLength(3)
  })

  it('puts the count last, so every count in the sidebar shares one column', () => {
    // The controls used to sit to the right of the count, and a repo
    // contributing three of them pushed its count further left than one
    // contributing two — so no two counts lined up. The controls take the
    // slack now and the count is flush against the row's right padding,
    // matching the branch rows and the scratch row.
    const { container } = renderHeader({}, { workspaceTabs: tabs, onAddBranch: vi.fn() })
    // eslint-disable-next-line testing-library/no-node-access -- the claim is the order of drawn elements; layout has no query
    const kids = [...container.querySelector('.repo-header')!.children].map((c) => c.className)
    expect(kids.indexOf('repo-header__count')).toBeGreaterThan(kids.indexOf('repo-header__hover'))
    expect(kids[kids.length - 1]).toBe('repo-header__count')
  })

  it('draws the disclosure chevron at rest, at the head of the row', () => {
    // It used to live inside the hover group, so at rest there was nothing on
    // screen saying whether a repo was collapsed.
    const { container } = renderHeader()
    // eslint-disable-next-line testing-library/no-node-access -- the claim is the order of drawn elements; layout has no query
    const kids = [...container.querySelector('.repo-header')!.children].map((c) => c.className)
    expect(kids[0]).toBe('repo-header__chevron')
  })
})

describe('RepoHeader — open in editor', () => {
  it('offers the action named after the editor that will run', async () => {
    const user = userEvent.setup()
    renderHeader({}, { onOpenInEditor: vi.fn(), editorName: 'Cursor' })
    await user.pointer({ keys: '[MouseRight]', target: header() })
    expect(screen.getByText('Open in Cursor')).toBeTruthy()
  })

  it('opens the repo folder without also collapsing it', async () => {
    const user = userEvent.setup()
    const onOpenInEditor = vi.fn()
    const onToggleCollapse = vi.fn()
    renderHeader({}, { onOpenInEditor, onToggleCollapse })
    await user.pointer({ keys: '[MouseRight]', target: header() })
    await user.click(screen.getByText('Open in editor'))
    expect(onOpenInEditor).toHaveBeenCalled()
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })

  it('opens a menu for it even when nothing else would', async () => {
    const user = userEvent.setup()
    renderHeader({}, { onOpenInEditor: vi.fn() })
    await user.pointer({ keys: '[MouseRight]', target: header() })
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('offers nothing when there is no way to open an editor', async () => {
    const user = userEvent.setup()
    renderHeader({}, { onEdit: vi.fn() })
    await user.pointer({ keys: '[MouseRight]', target: header() })
    expect(screen.queryByText(/Open in/)).toBeNull()
  })
})

describe('RepoHeader — keyboard, drop target and a pathless repo', () => {
  it.each(['{Enter}', ' '])('collapses on %s, and ignores other keys', async (key) => {
    const user = userEvent.setup()
    const onToggleCollapse = vi.fn()
    renderHeader({}, { onToggleCollapse })
    const row = header()
    row.focus()
    expect(row.matches(':focus')).toBe(true)
    await user.keyboard('a')
    expect(onToggleCollapse).not.toHaveBeenCalled()
    await user.keyboard(key)
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('marks itself while a dragged repo is over it', () => {
    renderHeader({}, { dragOver: true })
    expect(header().className).toContain('repo-header--dnd-over')
  })

  it('puts no tooltip on the name of a repo with no folder', () => {
    renderHeader({ folderPath: '' })
    expect(repoName().hasAttribute('title')).toBe(false)
  })
})
