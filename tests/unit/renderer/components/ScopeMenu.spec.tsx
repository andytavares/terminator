import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScopeMenu } from '../../../../src/renderer/components/sidebar/ScopeMenu'

const tabs = [
  { id: 'speckit', label: 'SpecKit', component: () => null },
  { id: 'reviews', label: 'Code Reviews', component: () => null },
]

let props: React.ComponentProps<typeof ScopeMenu>

beforeEach(() => {
  props = {
    x: 10,
    y: 20,
    projectName: 'API',
    workspaceTabs: tabs,
    onSelectWorkspaceTab: vi.fn(),
    onAddSession: vi.fn(),
    onRemoveProject: vi.fn(),
    onDismiss: vi.fn(),
  }
})

describe('ScopeMenu — the second host for scope actions (FR-027)', () => {
  it('offers the same workspace-scoped extension actions the header hosts', () => {
    render(<ScopeMenu {...props} />)
    expect(screen.getByText('SpecKit')).toBeTruthy()
    expect(screen.getByText('Code Reviews')).toBeTruthy()
  })

  it('fires the workspace tab with its id', () => {
    render(<ScopeMenu {...props} />)
    fireEvent.click(screen.getByText('Code Reviews'))
    expect(props.onSelectWorkspaceTab).toHaveBeenCalledWith('reviews')
  })

  it('offers new terminal for the row project', () => {
    render(<ScopeMenu {...props} />)
    fireEvent.click(screen.getByText('New terminal'))
    expect(props.onAddSession).toHaveBeenCalledOnce()
  })

  it('names the project in the destructive action so it cannot be misread', () => {
    render(<ScopeMenu {...props} />)
    fireEvent.click(screen.getByText('Remove API'))
    expect(props.onRemoveProject).toHaveBeenCalledOnce()
  })

  it('dismisses itself before acting, so the menu never outlives the click', () => {
    render(<ScopeMenu {...props} />)
    fireEvent.click(screen.getByText('New terminal'))
    expect(props.onDismiss).toHaveBeenCalledOnce()
  })

  it('still offers project actions when no extension contributes a workspace tab', () => {
    render(<ScopeMenu {...props} workspaceTabs={[]} />)
    expect(screen.getByText('New terminal')).toBeTruthy()
    expect(screen.getByText('Remove API')).toBeTruthy()
  })

  it('positions itself where the badge was clicked', () => {
    const { container } = render(<ScopeMenu {...props} />)
    const menu = container.querySelector('.ctx-menu') as HTMLElement
    expect([menu.style.left, menu.style.top]).toEqual(['10px', '20px'])
  })
})

// ── Issue actions ───────────────────────────────────────────────────────────

describe('ScopeMenu — the attached issue', () => {
  const handlers = {
    onLinkIssue: vi.fn(),
    onOpenIssue: vi.fn(),
    onCopyIssueKey: vi.fn(),
    onUnlinkIssue: vi.fn(),
  }

  function open(over: Record<string, unknown> = {}) {
    return render(
      <ScopeMenu
        x={0}
        y={0}
        projectName="terminator"
        workspaceTabs={[]}
        onSelectWorkspaceTab={vi.fn()}
        onAddSession={vi.fn()}
        onRemoveProject={vi.fn()}
        onDismiss={vi.fn()}
        {...handlers}
        {...over}
      />
    )
  }

  beforeEach(() => vi.clearAllMocks())

  it('offers only Link when nothing is attached', () => {
    open({ issueKey: null })
    expect(screen.getByText('Link issue…')).toBeTruthy()
    // Four dead rows against no issue would be worse than none.
    expect(screen.queryByText('Copy issue key')).toBeNull()
    expect(screen.queryByText(/^Unlink/)).toBeNull()
    expect(screen.queryByText(/Open .* in tracker/)).toBeNull()
  })

  it('offers the full set once an issue is attached, naming it', () => {
    open({ issueKey: 'TAV-42' })
    expect(screen.getByText('Open TAV-42 in tracker')).toBeTruthy()
    expect(screen.getByText('Copy issue key')).toBeTruthy()
    expect(screen.getByText('Change linked issue…')).toBeTruthy()
    expect(screen.getByText('Unlink TAV-42')).toBeTruthy()
    expect(screen.queryByText('Link issue…')).toBeNull()
  })

  it('offers nothing at all when the host does not support issues', () => {
    open({ issueKey: null, onLinkIssue: undefined })
    expect(screen.queryByText('Link issue…')).toBeNull()
  })

  it.each([
    ['Link issue…', 'onLinkIssue', null],
    ['Open TAV-42 in tracker', 'onOpenIssue', 'TAV-42'],
    ['Copy issue key', 'onCopyIssueKey', 'TAV-42'],
    ['Change linked issue…', 'onLinkIssue', 'TAV-42'],
    ['Unlink TAV-42', 'onUnlinkIssue', 'TAV-42'],
  ])('%s calls its handler and dismisses', (label, handler, issueKey) => {
    const onDismiss = vi.fn()
    open({ issueKey, onDismiss })
    fireEvent.click(screen.getByText(label as string))

    expect(handlers[handler as keyof typeof handlers]).toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalled()
  })

  it('does not throw when an optional handler is absent', () => {
    open({
      issueKey: 'TAV-42',
      onOpenIssue: undefined,
      onCopyIssueKey: undefined,
      onUnlinkIssue: undefined,
    })
    expect(() => fireEvent.click(screen.getByText('Open TAV-42 in tracker'))).not.toThrow()
  })

  it('keeps Remove last and destructive', () => {
    open({ issueKey: 'TAV-42' })
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels[labels.length - 1]).toContain('Remove terminator')
  })
})
