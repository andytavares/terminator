import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../../../../src/renderer/components/session/LivePreview', () => ({
  LivePreview: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`preview-${sessionId}`} />
  ),
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useIssue: () => undefined,
}))

import { WallTile } from '../../../../src/renderer/components/overview/WallTile'
import { fact } from '../sidebar/fixtures/facts'
import { useAddToTaskStore } from '../../../../src/renderer/components/tasks/add-to-task'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const facts = fact({
  sessionId: 's1',
  name: 'claude',
  state: 'working',
  workspaceName: 'Northwind',
  projectName: 'northwind-api',
  branch: 'nw-88-rate-limits',
  workspaceColor: '#3fa39a',
  lastActivityAt: NOW - 6 * 60_000,
})

let props: React.ComponentProps<typeof WallTile>

beforeEach(() => {
  props = {
    facts,
    placement: { sessionId: 's1', band: 'rest', order: 3, span: 1 },
    metrics: null,
    now: NOW,
    onOpen: vi.fn(),
    onSaveDescription: vi.fn(),
  }
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('WallTile', () => {
  it('is named by where the session lives and what it is', () => {
    render(<WallTile {...props} />)
    expect(
      screen.getByRole('article', { name: 'Northwind / northwind-api / nw-88-rate-limits, claude' })
    ).toBeTruthy()
  })

  it('captions state, location, name and age over a live preview', () => {
    render(<WallTile {...props} />)
    const tile = screen.getByRole('article')
    expect(within(tile).getByRole('img', { name: 'Running' })).toBeTruthy()
    expect(within(tile).getByText('Northwind / northwind-api / nw-88-rate-limits')).toBeTruthy()
    expect(within(tile).getByText('claude')).toBeTruthy()
    expect(within(tile).getByText('6m')).toBeTruthy()
    expect(within(tile).getByTestId('preview-s1')).toBeTruthy()
  })

  it('asks what the session is for in its footer', () => {
    render(<WallTile {...props} />)
    expect(screen.getByRole('textbox', { name: 'What is this session doing?' })).toBeTruthy()
  })
})

describe('WallTile — names a session with no project', () => {
  it('names a session with no project', () => {
    render(
      <WallTile
        {...props}
        facts={{ ...facts, workspaceName: null, projectName: null, branch: null }}
      />
    )
    expect(screen.getByRole('article', { name: 'No branch, claude' })).toBeTruthy()
  })

  it('opens the terminal from its button, a click, or Enter', () => {
    render(<WallTile {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open claude' }))
    fireEvent.click(screen.getByTestId('preview-s1'))
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    expect(props.onOpen).toHaveBeenCalledTimes(3)
    expect(recordUse.mock.calls).toEqual(Array(3).fill(['core.overview.open-tile']))
    expect(props.onOpen).toHaveBeenCalledWith('s1')
  })

  it('does not open the terminal while typing a description', () => {
    render(<WallTile {...props} />)
    const box = screen.getByRole('textbox', { name: 'What is this session doing?' })
    fireEvent.click(box)
    fireEvent.change(box, { target: { value: 'why' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(props.onSaveDescription).toHaveBeenCalledWith(facts, 'why')
  })
})

describe('WallTile — carries its position and span as style alone', () => {
  it('carries its position and span as style alone', () => {
    render(
      <WallTile {...props} placement={{ sessionId: 's1', band: 'needs', order: 1, span: 2 }} />
    )
    const tile = screen.getByRole('article')
    expect(tile.style.order).toBe('1')
    expect(tile.style.gridColumn).toBe('span 2')
    expect(tile.getAttribute('data-band')).toBe('needs')
  })

  it('draws the workspace colour as its edge and nowhere else', () => {
    render(<WallTile {...props} />)
    expect(screen.getByRole('article').style.getPropertyValue('--rail')).toBe('#3fa39a')
  })

  it('shows process load when it is known', () => {
    render(
      <WallTile {...props} metrics={{ pid: 1, cpuPercent: 12.5, rssBytes: 48 * 1024 * 1024 }} />
    )
    expect(screen.getByText('12.5% 48 MB')).toBeTruthy()
  })

  it.each([
    [2 * 1024 * 1024 * 1024, '12.5% 2.0 GB'],
    [512 * 1024, '12.5% 512 KB'],
  ])('formats memory at its scale: %d bytes', (rssBytes, text) => {
    render(<WallTile {...props} metrics={{ pid: 1, cpuPercent: 12.5, rssBytes }} />)
    expect(screen.getByText(text)).toBeTruthy()
  })
})

describe('WallTile — draws answers in its footer when a prompt is waiting', () => {
  it('draws answers in its footer when a prompt is waiting', () => {
    render(<WallTile {...props} answers={<button type="button">1. Yes</button>} />)
    expect(within(screen.getByRole('article')).getByRole('button', { name: '1. Yes' })).toBeTruthy()
  })

  it('offers a link when linking is possible', () => {
    const onLink = vi.fn()
    render(<WallTile {...props} onLink={onLink} />)
    fireEvent.click(screen.getByRole('button', { name: 'Link a work item' }))
    expect(onLink).toHaveBeenCalledWith(facts)
    expect(props.onOpen).not.toHaveBeenCalled()
  })
})

describe('WallTile — offers Resume on a stopped session whose conversation is still there', () => {
  it('offers Resume on a stopped session whose conversation is still there', () => {
    const onResume = vi.fn()
    render(
      <WallTile
        {...props}
        facts={{
          ...facts,
          state: 'exited',
          agent: {
            agentId: 'claude',
            transport: 'tui',
            sessionId: 'conv-1',
            transcriptPath: '/t/c.jsonl',
            cwd: '/code/repo',
            capturedAt: '2026-09-15T18:00:00.000Z',
          },
          resumable: true,
        }}
        onResume={onResume}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(onResume).toHaveBeenCalled()
    expect(props.onOpen).not.toHaveBeenCalled()
  })
})

describe('WallTile — says when a stopped session’s conversation has gone', () => {
  it('says when a stopped session’s conversation has gone', () => {
    render(
      <WallTile
        {...props}
        facts={{
          ...facts,
          state: 'exited',
          agent: {
            agentId: 'claude',
            transport: 'tui',
            sessionId: 'conv-1',
            transcriptPath: '/t/gone.jsonl',
            cwd: '/code/repo',
            capturedAt: '2026-09-15T18:00:00.000Z',
          },
          resumable: false,
        }}
        onResume={vi.fn()}
      />
    )
    expect(screen.getByText('Conversation no longer available')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull()
  })
})

describe('WallTile — ends the session from its tile without opening it', () => {
  it('ends the session from its tile without opening it', () => {
    const onCloseSession = vi.fn()
    render(<WallTile {...props} onCloseSession={onCloseSession} />)
    fireEvent.click(screen.getByRole('button', { name: /^Close / }))
    expect(onCloseSession).toHaveBeenCalled()
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('offers no Resume while the session is running', () => {
    render(<WallTile {...props} onResume={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull()
  })

  it('marks a needs-you tile so its edge reads amber', () => {
    render(<WallTile {...props} facts={{ ...facts, state: 'awaiting-input' }} />)
    expect(screen.getByRole('article').className).toContain('wall-tile--needs')
  })

  it('does not mark a working tile as needs-you', () => {
    render(<WallTile {...props} facts={{ ...facts, state: 'working' }} />)
    expect(screen.getByRole('article').className).not.toContain('wall-tile--needs')
  })
})

describe('WallTile — what does not open it', () => {
  it('ignores a click on the footer itself', () => {
    const { container } = render(<WallTile {...props} />)
    fireEvent.click(container.querySelector('.wall-tile__foot')!)
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('ignores keys other than Enter, and Enter from inside the tile', () => {
    render(<WallTile {...props} />)
    fireEvent.keyDown(screen.getByRole('article'), { key: ' ' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open claude' }), { key: 'Enter' })
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('draws no edge colour for a session with no workspace colour', () => {
    render(<WallTile {...props} facts={{ ...facts, workspaceColor: null }} />)
    expect(screen.getByRole('article').style.getPropertyValue('--rail')).toBe('')
  })
})

function seedNorthwind(): void {
  useAddToTaskStore.getState().close()
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [workspaceFixture({ id: 'ws-nw', name: 'Northwind', folderPath: '/nw' })],
    projectsByWorkspaceId: new Map([
      [
        'ws-nw',
        [projectFixture({ id: 'p-nw', workspaceId: 'ws-nw', gitBranch: 'nw-88-rate-limits' })],
      ],
    ]),
  })
}

describe('WallTile — Add to task…', () => {
  beforeEach(seedNorthwind)

  it('opens the picker for the tile’s repo and branch from its menu, without opening the tile', () => {
    render(<WallTile {...props} facts={{ ...facts, projectId: 'p-nw' }} />)
    fireEvent.contextMenu(screen.getByRole('article'))
    fireEvent.click(screen.getByText('Add to task…'))
    expect(useAddToTaskStore.getState().lane).toEqual({
      repoRoot: '/nw',
      branch: 'nw-88-rate-limits',
    })
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(screen.queryByText('Add to task…')).toBeNull()
  })

  it('has no menu for a terminal on no branch', () => {
    render(<WallTile {...props} facts={{ ...facts, projectId: null }} />)
    fireEvent.contextMenu(screen.getByRole('article'))
    expect(screen.queryByText('Add to task…')).toBeNull()
  })
})
