import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionGroup } from '../../../../src/renderer/components/sidebar/SessionGroup'
import type { Group } from '../../../../src/renderer/sidebar/view-model'

const projectGroup: Group = {
  key: 'p1',
  label: 'API',
  scope: { kind: 'project', projectId: 'p1', workspaceId: 'w1' },
  sessions: [],
  count: 3,
}

const statusGroup: Group = { key: 'idle', label: 'Idle', sessions: [], count: 2 }

const tabs = [
  { id: 'speckit', label: 'SpecKit', component: () => null },
  { id: 'reviews', label: 'Code Reviews', component: () => null },
]

let onToggleCollapse: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  onToggleCollapse = vi.fn()
})

function renderGroup(props: Partial<React.ComponentProps<typeof SessionGroup>> = {}) {
  return render(
    <SessionGroup
      group={projectGroup}
      collapsed={false}
      onToggleCollapse={onToggleCollapse}
      {...props}
    >
      <div data-testid="child" />
    </SessionGroup>
  )
}

describe('SessionGroup — a scope-bearing header (FR-026)', () => {
  it('renders the label and count', () => {
    renderGroup()
    expect(screen.getByText('API')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('renders its sessions when expanded', () => {
    renderGroup()
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('hides its sessions when collapsed', () => {
    renderGroup({ collapsed: true })
    expect(screen.queryByTestId('child')).toBeNull()
  })

  it('toggles from the chevron without needing the whole header', () => {
    const { container } = renderGroup()
    fireEvent.click(container.querySelector('.session-group__chevron')!)
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('toggles from the header when the group has no scope to select', () => {
    const { container } = renderGroup({ group: statusGroup })
    fireEvent.click(container.querySelector('.session-group__header')!)
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('selects the scope on a header click, as the tree project row did', () => {
    const onSelectScope = vi.fn()
    const { container } = renderGroup({ onSelectScope })
    fireEvent.click(container.querySelector('.session-group__header')!)
    expect(onSelectScope).toHaveBeenCalledOnce()
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })

  it('still collapses from the chevron when the header selects', () => {
    const onSelectScope = vi.fn()
    const { container } = renderGroup({ onSelectScope })
    fireEvent.click(container.querySelector('.session-group__chevron')!)
    expect(onToggleCollapse).toHaveBeenCalledOnce()
    expect(onSelectScope).not.toHaveBeenCalled()
  })

  it('tints the header with the workspace colour, which is how you tell workspaces apart', () => {
    const { container } = renderGroup({ workspaceColor: '#abcdef' })
    const root = container.querySelector('.session-group') as HTMLElement
    expect(root.style.getPropertyValue('--ws-color')).toBe('#abcdef')
  })

  it('creates a session from the header without toggling collapse', () => {
    const onAddSession = vi.fn()
    renderGroup({ onAddSession })
    fireEvent.click(screen.getByTitle('New terminal'))
    expect(onAddSession).toHaveBeenCalledOnce()
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })

  it('shows a busy aggregate when any session in the group is busy', () => {
    const { container } = renderGroup({ busy: true })
    expect(container.querySelector('.session-group__busy')).toBeTruthy()
  })

  it('opens a context menu offering rename and remove', () => {
    const { container } = renderGroup({ onRename: vi.fn(), onRemove: vi.fn() })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('opens no context menu when the group has no scope actions', () => {
    const { container } = renderGroup({ group: statusGroup })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('applies the workspace colour band', () => {
    const { container } = renderGroup({ workspaceColor: '#abcdef' })
    const el = container.querySelector('.session-group') as HTMLElement
    expect(el.style.getPropertyValue('--ws-color')).toBe('#abcdef')
  })
})

describe('SessionGroup — hosting workspace extension buttons (surface 2)', () => {
  it('renders one button per contributed workspace tab', () => {
    renderGroup({ workspaceTabs: tabs })
    expect(screen.getByTitle('SpecKit')).toBeTruthy()
    expect(screen.getByTitle('Code Reviews')).toBeTruthy()
  })

  it('fires the tab without toggling collapse', () => {
    const onSelectWorkspaceTab = vi.fn()
    renderGroup({ workspaceTabs: tabs, onSelectWorkspaceTab })
    fireEvent.click(screen.getByTitle('SpecKit'))
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('speckit')
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })

  it('marks the active workspace tab', () => {
    const { container } = renderGroup({ workspaceTabs: tabs, activeWorkspaceTabId: 'reviews' })
    expect(container.querySelectorAll('.session-group__ws-tab--active')).toHaveLength(1)
  })

  it('renders no tab strip when no extension contributes one', () => {
    const { container } = renderGroup({ workspaceTabs: [] })
    expect(container.querySelector('.session-group__ws-tabs')).toBeNull()
  })

  it('still renders the tabs when the group is collapsed — the header stays the host', () => {
    renderGroup({ collapsed: true, workspaceTabs: tabs })
    expect(screen.getByTitle('SpecKit')).toBeTruthy()
  })

  it('renames inline from the context menu, replacing the label with an input', () => {
    const onRename = vi.fn()
    const { container } = renderGroup({ onRename })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector('.session-group__rename-input') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('Renamed')
  })

  it('commits an inline rename on blur', () => {
    const onRename = vi.fn()
    const { container } = renderGroup({ onRename })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector('.session-group__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Blurred' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('Blurred')
  })

  it('abandons an inline rename on Escape', () => {
    const onRename = vi.fn()
    const { container } = renderGroup({ onRename })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector('.session-group__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('API')).toBeTruthy()
  })

  it('ignores a rename that is empty or unchanged', () => {
    const onRename = vi.fn()
    const { container } = renderGroup({ onRename })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector('.session-group__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('does not select the header when the rename input itself is clicked', () => {
    const { container } = renderGroup({ onRename: vi.fn() })
    fireEvent.contextMenu(container.querySelector('.session-group__header')!)
    fireEvent.click(screen.getByText('Rename'))
    onToggleCollapse.mockClear()
    fireEvent.click(container.querySelector('.session-group__rename-input')!)
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })
})

// ── Issue actions on the group header ───────────────────────────────────────
//
// This is the menu a right-click actually reaches when the sidebar is grouped
// by project — which is the default. The actions first shipped only on
// ScopeMenu, which is the *other* grouping, so they were unreachable for
// everyone using the default view. Tested here so that cannot recur.

describe('SessionGroup — the attached issue', () => {
  const actions = {
    onLinkIssue: vi.fn(),
    onOpenIssue: vi.fn(),
    onCopyIssueKey: vi.fn(),
    onUnlinkIssue: vi.fn(),
  }

  function openMenu(issueActions: Record<string, unknown> | undefined) {
    const { container } = render(
      <SessionGroup
        group={
          {
            key: 'p1',
            label: 'terminator',
            count: 1,
            sessions: [],
            scope: { projectId: 'p1' },
          } as never
        }
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        issueActions={issueActions as never}
      >
        <div />
      </SessionGroup>
    )
    fireEvent.contextMenu(container.querySelector('.session-group__header') as Element)
  }

  beforeEach(() => vi.clearAllMocks())

  it('offers Link when the project has no issue', () => {
    openMenu({ issueKey: null, ...actions })
    expect(screen.getByText('Link issue…')).toBeTruthy()
  })

  it('offers the full set once an issue is attached', () => {
    openMenu({ issueKey: 'TAV-42', ...actions })
    expect(screen.getByText('Open TAV-42 in tracker')).toBeTruthy()
    expect(screen.getByText('Copy issue key')).toBeTruthy()
    expect(screen.getByText('Change linked issue…')).toBeTruthy()
    expect(screen.getByText('Unlink TAV-42')).toBeTruthy()
  })

  it('still offers Rename and Remove alongside them', () => {
    openMenu({ issueKey: 'TAV-42', ...actions })
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('calls the handler for the item picked', () => {
    openMenu({ issueKey: 'TAV-42', ...actions })
    fireEvent.click(screen.getByText('Copy issue key'))
    expect(actions.onCopyIssueKey).toHaveBeenCalled()
  })

  it('shows only Rename and Remove when the host offers no issue actions', () => {
    openMenu(undefined)
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.queryByText('Link issue…')).toBeNull()
  })
})

describe('SessionGroup — naming the workspace a project belongs to', () => {
  it('renders the workspace name beside the project name', () => {
    const { container } = renderGroup({ workspaceName: 'Backend' })
    expect(container.querySelector('.session-group__workspace')!.textContent).toBe('Backend')
  })

  it('renders nothing extra when no workspace name is given', () => {
    const { container } = renderGroup()
    expect(container.querySelector('.session-group__workspace')).toBeNull()
  })

  it('marks a nested group so the project layer reads as one', () => {
    const { container } = renderGroup({ nested: true })
    expect(container.querySelector('.session-group--nested')).toBeTruthy()
  })
})

describe('SessionGroup — the branch is the identity (US2)', () => {
  const worktreeGroup: Group = {
    key: 'p2',
    label: 'TAV-14 Make all text red',
    scope: { kind: 'project', projectId: 'p2', workspaceId: 'w1' },
    sessions: [],
    count: 0,
  }

  function renderBranch(props: Partial<React.ComponentProps<typeof SessionGroup>> = {}) {
    return render(
      <SessionGroup
        group={projectGroup}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        branchName={{ primary: 'main', secondary: undefined }}
        isWorktree={false}
        {...props}
      >
        <div data-testid="child" />
      </SessionGroup>
    )
  }

  it('marks a worktree branch differently from a plain checkout', () => {
    const wt = renderBranch({ group: worktreeGroup, isWorktree: true, worktreePath: '/r/.wt/x' })
    const wtGlyph = wt.container
      .querySelector('.session-group__branch-glyph')!
      .getAttribute('data-kind')
    wt.unmount()

    const plain = renderBranch({ isWorktree: false })
    const plainGlyph = plain.container
      .querySelector('.session-group__branch-glyph')!
      .getAttribute('data-kind')

    expect(wtGlyph).toBe('worktree')
    expect(plainGlyph).toBe('branch')
    expect(wtGlyph).not.toBe(plainGlyph)
  })

  it('tags a worktree and reveals its path on hover', () => {
    const { container } = renderBranch({ isWorktree: true, worktreePath: '/r/.worktrees/tav-14' })
    const tag = container.querySelector('.session-group__worktree-tag')!
    expect(tag.textContent).toBe('worktree')
    expect(tag.getAttribute('title')).toBe('/r/.worktrees/tav-14')
  })

  it('puts no worktree tag on a plain checkout', () => {
    const { container } = renderBranch({ isWorktree: false })
    expect(container.querySelector('.session-group__worktree-tag')).toBeNull()
  })

  it('shows the branch alone when the label is just the branch name', () => {
    const { container } = renderBranch({ branchName: { primary: 'main' } })
    expect(container.querySelector('.session-group__label')!.textContent).toContain('main')
    expect(container.querySelector('.session-group__branch-secondary')).toBeNull()
  })

  it('keeps the branch visible beside a human label', () => {
    const { container } = renderBranch({
      group: worktreeGroup,
      branchName: { primary: 'TAV-14 Make all text red', secondary: 'andrew/tav-14' },
    })
    expect(container.querySelector('.session-group__label')!.textContent).toContain(
      'TAV-14 Make all text red'
    )
    expect(container.querySelector('.session-group__branch-secondary')!.textContent).toBe(
      'andrew/tav-14'
    )
  })

  it('renders change statistics when they are available', () => {
    const { container } = renderBranch({ changeStats: { added: 48, removed: 12, files: 3 } })
    const stats = container.querySelector('.session-group__stats')!
    expect(stats.textContent).toContain('48')
    expect(stats.textContent).toContain('12')
  })

  it('renders no statistics at all when they are absent', () => {
    const { container } = renderBranch({ changeStats: undefined })
    expect(container.querySelector('.session-group__stats')).toBeNull()
  })

  it('renders no statistics and no error affordance when git failed', () => {
    const { container } = renderBranch({ changeStats: null })
    expect(container.querySelector('.session-group__stats')).toBeNull()
    expect(container.textContent).not.toMatch(/error|failed|unavailable/i)
  })

  it('omits statistics for a clean tree rather than showing +0 −0', () => {
    const { container } = renderBranch({ changeStats: { added: 0, removed: 0, files: 0 } })
    expect(container.querySelector('.session-group__stats')).toBeNull()
  })

  it('names the repo folder path on a repo group header', () => {
    const repoGroup: Group = {
      key: 'w1',
      label: 'Backend',
      scope: { kind: 'workspace', workspaceId: 'w1' },
      sessions: [],
      count: 0,
    }
    const { container } = render(
      <SessionGroup
        group={repoGroup}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        repoPath="~/repos/backend"
      >
        <div />
      </SessionGroup>
    )
    expect(container.querySelector('.session-group__repo-path')!.textContent).toBe(
      '~/repos/backend'
    )
  })

  it('puts no colour on the branch glyph (constitution XII)', () => {
    const { container } = renderBranch({ isWorktree: true })
    const svg = container.querySelector('.session-group__branch-glyph') as SVGElement
    expect(svg.style.color).toBe('')
  })
})
