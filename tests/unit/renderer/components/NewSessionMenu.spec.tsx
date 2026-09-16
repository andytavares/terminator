import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Project, Workspace } from '../../../../src/shared/types/index'

const workspace = vi.hoisted(() => ({
  workspaces: [] as Workspace[],
  projectsByWorkspaceId: new Map<string, Project[]>(),
}))

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: (select: (s: unknown) => unknown) => select(workspace),
}))

import { NewSessionMenu } from '../../../../src/renderer/components/session/NewSessionMenu'

const repo = (id: string, name: string): Workspace => ({ id, name }) as Workspace
const branch = (id: string, workspaceId: string, name: string): Project =>
  ({ id, workspaceId, name }) as Project

let onBranch: ReturnType<typeof vi.fn>
let onScratch: ReturnType<typeof vi.fn>

function open() {
  render(<NewSessionMenu onStartInBranch={onBranch} onStartScratch={onScratch} />)
  fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  onBranch = vi.fn()
  onScratch = vi.fn()
  workspace.workspaces = [repo('w1', 'terminator'), repo('w2', 'northwind')]
  workspace.projectsByWorkspaceId = new Map([
    ['w1', [branch('p1', 'w1', 'main'), branch('p2', 'w1', 'session-home')]],
    ['w2', [branch('p3', 'w2', 'rate-limits')]],
  ])
})

describe('NewSessionMenu', () => {
  it('is closed until asked', () => {
    render(<NewSessionMenu onStartInBranch={onBranch} onStartScratch={onScratch} />)
    expect(screen.queryByRole('menu', { name: 'Start a terminal' })).toBeNull()
  })

  it('lists every branch under its repo, and a scratch terminal', () => {
    open()
    const menu = screen.getByRole('menu', { name: 'Start a terminal' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.getAttribute('aria-label'))
    ).toEqual([
      'New terminal in terminator / main',
      'New terminal in terminator / session-home',
      'New terminal in northwind / rate-limits',
      'New scratch terminal',
    ])
  })

  it('starts a terminal in the branch chosen, and closes', () => {
    open()
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'New terminal in terminator / session-home' })
    )
    expect(onBranch).toHaveBeenCalledWith('p2')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('starts a scratch terminal', () => {
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scratch terminal' }))
    expect(onScratch).toHaveBeenCalled()
  })

  it('offers a scratch terminal even with no repos at all', () => {
    workspace.workspaces = []
    workspace.projectsByWorkspaceId = new Map()
    open()
    const menu = screen.getByRole('menu', { name: 'Start a terminal' })
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
    expect(within(menu).getByText('No branches yet')).toBeTruthy()
  })

  it('closes on a click elsewhere', () => {
    open()
    fireEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
