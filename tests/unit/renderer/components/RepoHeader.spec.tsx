import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoHeader } from '../../../../src/renderer/components/sidebar/RepoHeader'
import type { RepoGroup } from '../../../../src/renderer/sidebar/branch-rows'

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

/** Drawn at rest, excluding the colour swatch — identity, not a fact. */
const restingElements = (container: HTMLElement): number =>
  [...container.querySelector('.repo-header')!.children].filter(
    (c) =>
      !c.classList.contains('repo-header__hover') && !c.classList.contains('repo-header__swatch')
  ).length

describe('RepoHeader', () => {
  it('names the repo in the human face and counts its branches', () => {
    const { container } = renderHeader()
    expect(container.querySelector('.repo-header__name')!.textContent).toBe('terminator')
    expect(container.querySelector('.repo-header__count')!.textContent).toBe('4')
  })

  // FR-030. The path is available, and drawn nowhere.
  it('offers the folder path as a tooltip rather than drawing it', () => {
    const { container } = renderHeader()
    const header = container.querySelector('.repo-header')!
    expect(header.getAttribute('title')).toBe('/repos/terminator')
    expect(header.textContent).not.toContain('/repos/terminator')
  })

  // FR-043. The colour is a swatch; the name is ordinary text.
  it('carries the repo colour as a swatch, not as the name colour', () => {
    const { container } = renderHeader()
    const header = container.querySelector<HTMLElement>('.repo-header')!
    expect(header.style.getPropertyValue('--ws-color')).toBe('#5c6bc0')
    expect(container.querySelector('.repo-header__swatch')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('.repo-header__name')!.style.color).toBe('')
  })

  it('draws no swatch for a group with no colour', () => {
    const { container } = renderHeader({ color: '' })
    expect(container.querySelector('.repo-header__swatch')).toBeNull()
  })

  // FR-027.
  it('draws no more than three elements at rest', () => {
    const { container } = renderHeader()
    expect(restingElements(container)).toBeLessThanOrEqual(3)
  })

  it('still draws no more than three when collapsed and something is waiting', () => {
    const { container } = renderHeader({ needsYou: true }, { collapsed: true })
    expect(restingElements(container)).toBeLessThanOrEqual(3)
  })

  // FR-004. Collapsing a repo must not hide the one thing you needed to see.
  it('signals a waiting branch only while collapsed', () => {
    const { container: open } = renderHeader({ needsYou: true })
    expect(open.querySelector('.repo-header__needs-you')).toBeNull()
    const { container: shut } = renderHeader({ needsYou: true }, { collapsed: true })
    expect(shut.querySelector('.repo-header__needs-you')).toBeTruthy()
  })

  it('stays quiet when collapsed with nothing waiting', () => {
    const { container } = renderHeader({ needsYou: false }, { collapsed: true })
    expect(container.querySelector('.repo-header__needs-you')).toBeNull()
  })

  it('names the waiting signal for a reader', () => {
    const { container } = renderHeader({ needsYou: true }, { collapsed: true })
    expect(container.querySelector('.repo-header__needs-you')!.getAttribute('aria-label')).toMatch(
      /waiting/i
    )
  })

  describe('interaction', () => {
    it('collapses on click', () => {
      const onToggleCollapse = vi.fn()
      const { container } = renderHeader({}, { onToggleCollapse })
      fireEvent.click(container.querySelector('.repo-header')!)
      expect(onToggleCollapse).toHaveBeenCalled()
    })

    it.each(['Enter', ' '])('collapses on %s', (key) => {
      const onToggleCollapse = vi.fn()
      const { container } = renderHeader({}, { onToggleCollapse })
      fireEvent.keyDown(container.querySelector('.repo-header')!, { key })
      expect(onToggleCollapse).toHaveBeenCalled()
    })

    it('reports its expanded state', () => {
      const { container } = renderHeader({}, { collapsed: true })
      expect(container.querySelector('.repo-header')!.getAttribute('aria-expanded')).toBe('false')
    })

    // FR-005. Creating a branch moved here from an always-visible row.
    it('offers a new branch without also collapsing the repo', () => {
      const onAddBranch = vi.fn()
      const onToggleCollapse = vi.fn()
      renderHeader({}, { onAddBranch, onToggleCollapse })
      fireEvent.click(screen.getByRole('button', { name: 'New branch in terminator' }))
      expect(onAddBranch).toHaveBeenCalled()
      expect(onToggleCollapse).not.toHaveBeenCalled()
    })

    it('hosts registered repo actions', () => {
      const onSelectWorkspaceTab = vi.fn()
      renderHeader(
        {},
        {
          workspaceTabs: [{ id: 'git', label: 'Git', component: () => null }],
          onSelectWorkspaceTab,
        }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Git' }))
      expect(onSelectWorkspaceTab).toHaveBeenCalledWith('git')
    })

    it('marks the active repo action', () => {
      const { container } = renderHeader(
        {},
        {
          workspaceTabs: [{ id: 'git', label: 'Git', component: () => null }],
          activeWorkspaceTabId: 'git',
        }
      )
      expect(container.querySelector('.repo-header__action--on')).toBeTruthy()
    })

    it('edits and removes from the context menu', () => {
      const onEdit = vi.fn()
      const onRemove = vi.fn()
      const { container } = renderHeader({}, { onEdit, onRemove })
      fireEvent.contextMenu(container.querySelector('.repo-header')!)
      fireEvent.click(screen.getByText('Edit workspace'))
      expect(onEdit).toHaveBeenCalled()
      fireEvent.contextMenu(container.querySelector('.repo-header')!)
      fireEvent.click(screen.getByText('Remove workspace'))
      expect(onRemove).toHaveBeenCalled()
    })

    it('opens no menu when there is nothing to put in it', () => {
      const { container } = renderHeader()
      fireEvent.contextMenu(container.querySelector('.repo-header')!)
      expect(document.querySelector('.ctx-menu')).toBeNull()
    })
  })
})
