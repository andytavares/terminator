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

  it('shows the worktree icon for a worktree-backed project', () => {
    const { container } = renderGroup({ isWorktree: true })
    expect(container.querySelector('.session-group__icon')).toBeTruthy()
  })

  it('shows no project icon for a non-scope group', () => {
    const { container } = renderGroup({ group: statusGroup })
    expect(container.querySelector('.session-group__icon')).toBeNull()
  })

  it('hosts the branch switcher when expanded', () => {
    renderGroup({ branchSwitcher: <div data-testid="branch" /> })
    expect(screen.getByTestId('branch')).toBeTruthy()
  })

  it('hides the branch switcher when collapsed', () => {
    renderGroup({ collapsed: true, branchSwitcher: <div data-testid="branch" /> })
    expect(screen.queryByTestId('branch')).toBeNull()
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
