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

  it('offers Resume on a stopped session whose conversation is still there', () => {
    const onResume = vi.fn()
    render(
      <WallTile
        {...props}
        facts={{
          ...facts,
          state: 'exited',
          agent: {
            provider: 'claude',
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

  it('offers no Resume while the session is running', () => {
    render(<WallTile {...props} onResume={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull()
  })
})
