import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Project, Workspace } from '../../../../src/shared/types/index'
import { NewSessionMenu } from '../../../../src/renderer/components/session/NewSessionMenu'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { projectFixture, seedStore, workspaceFixture } from '../../../support/renderer-stores'

const repo = (id: string, name: string): Workspace => workspaceFixture({ id, name })
const branch = (id: string, workspaceId: string, name: string): Project =>
  projectFixture({ id, workspaceId, name })

let onBranch: Mock<(projectId: string) => void>
let onScratch: Mock<() => void>

function open() {
  render(<NewSessionMenu onStartInBranch={onBranch} onStartScratch={onScratch} />)
  fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  onBranch = vi.fn()
  onScratch = vi.fn()
  seedStore(useWorkspaceStore, {
    workspaces: [repo('w1', 'terminator'), repo('w2', 'northwind')],
    projectsByWorkspaceId: new Map([
      ['w1', [branch('p1', 'w1', 'main'), branch('p2', 'w1', 'session-home')]],
      ['w2', [branch('p3', 'w2', 'rate-limits')]],
    ]),
  })
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
})

describe('NewSessionMenu — starts a scratch terminal', () => {
  it('starts a scratch terminal', () => {
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scratch terminal' }))
    expect(onScratch).toHaveBeenCalled()
  })

  it('offers a scratch terminal even with no repos at all', () => {
    seedStore(useWorkspaceStore, { workspaces: [], projectsByWorkspaceId: new Map() })
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
