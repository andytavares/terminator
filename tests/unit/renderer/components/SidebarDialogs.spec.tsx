import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarDialogs } from '../../../../src/renderer/components/sidebar/SidebarDialogs'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'

const workspace = workspaceFixture({ id: 'ws-1', name: 'Backend' })
const worktreeProject = projectFixture({
  id: 'p-1',
  workspaceId: 'ws-1',
  isWorktree: true,
  worktreePath: '/repos/backend-feature',
})
const plainProject = projectFixture({ id: 'p-2', workspaceId: 'ws-1' })

function renderRemoval() {
  useWorkspaceStore.setState({
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([['ws-1', [worktreeProject, plainProject]]]),
  })
  return render(
    <SidebarDialogs
      dialog={{ kind: 'remove-workspace', workspace }}
      close={() => {}}
      factsBySessionId={new Map()}
    />
  )
}

describe('SidebarDialogs — remove-workspace', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [], projectsByWorkspaceId: new Map() })
  })

  it('lists the worktree folders the removal deletes from disk', () => {
    renderRemoval()

    expect(screen.getByText('Remove workspace "Backend"?')).toBeTruthy()
    const description = document.querySelector('.tmui-dialog__description')!
    expect(description.textContent).toContain('/repos/backend-feature')
  })

  it('has no description when the workspace holds no worktrees', () => {
    useWorkspaceStore.setState({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [plainProject]]]),
    })
    render(
      <SidebarDialogs
        dialog={{ kind: 'remove-workspace', workspace }}
        close={() => {}}
        factsBySessionId={new Map()}
      />
    )

    expect(document.querySelector('.tmui-dialog__description')).toBeNull()
  })
})
