import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceRow } from '../../../../src/renderer/components/sidebar/WorkspaceRow'
import type { Workspace } from '../../../../src/shared/types/index'

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Backend',
  folderPath: '/b',
  color: '#5c6bc0',
  tags: ['api', 'go'],
  createdAt: '',
  updatedAt: '',
}

let props: React.ComponentProps<typeof WorkspaceRow>

beforeEach(() => {
  props = {
    workspace,
    onAddProject: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  }
})

describe('WorkspaceRow — the workspace keeps a home in the flat list', () => {
  it('names the workspace', () => {
    render(<WorkspaceRow {...props} />)
    expect(screen.getByText('Backend')).toBeTruthy()
  })

  it('carries the workspace colour band', () => {
    const { container } = render(<WorkspaceRow {...props} />)
    const row = container.querySelector('.ws-row') as HTMLElement
    expect(row.style.getPropertyValue('--ws-color')).toBe('#5c6bc0')
    expect(container.querySelector('.ws-row__band')).toBeTruthy()
  })

  it('shows the workspace tags', () => {
    render(<WorkspaceRow {...props} />)
    expect(screen.getByText('api')).toBeTruthy()
    expect(screen.getByText('go')).toBeTruthy()
  })

  it('adds a project', () => {
    render(<WorkspaceRow {...props} />)
    fireEvent.click(screen.getByText('Backend'))
    expect(props.onAddProject).toHaveBeenCalledOnce()
  })

  it('offers edit and remove on right-click, as the workspace card did', () => {
    const { container } = render(<WorkspaceRow {...props} />)
    fireEvent.contextMenu(container.querySelector('.ws-row')!)
    expect(screen.getByText('Edit workspace')).toBeTruthy()
    expect(screen.getByText('Remove workspace')).toBeTruthy()
  })

  it('edits the workspace', () => {
    const { container } = render(<WorkspaceRow {...props} />)
    fireEvent.contextMenu(container.querySelector('.ws-row')!)
    fireEvent.click(screen.getByText('Edit workspace'))
    expect(props.onEdit).toHaveBeenCalledOnce()
  })

  it('removes the workspace', () => {
    const { container } = render(<WorkspaceRow {...props} />)
    fireEvent.contextMenu(container.querySelector('.ws-row')!)
    fireEvent.click(screen.getByText('Remove workspace'))
    expect(props.onRemove).toHaveBeenCalledOnce()
  })

  it('renders no tag chips when the workspace has none', () => {
    const { container } = render(<WorkspaceRow {...props} workspace={{ ...workspace, tags: [] }} />)
    expect(container.querySelectorAll('.ws-row__tag')).toHaveLength(0)
  })
})
