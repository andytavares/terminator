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
