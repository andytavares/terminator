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

import { LedgerView } from '../../../../src/renderer/components/home/LedgerView'
import { DEFAULT_HOME_PREFS } from '../../../../src/renderer/sidebar/home-prefs'
import type { LedgerGroup } from '../../../../src/renderer/sidebar/ledger-rows'
import { fact } from '../sidebar/fixtures/facts'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const groups: LedgerGroup[] = [
  {
    key: 'Northwind / northwind-api',
    label: 'Northwind / northwind-api',
    facts: [
      fact({
        sessionId: 'a',
        name: 'claude',
        state: 'awaiting-input',
        branch: 'nw-88-rate-limits',
        latestLine: 'Make this edit?',
        lastActivityAt: NOW - 2 * 60_000,
        tags: ['client'],
      }),
      fact({ sessionId: 'b', name: 'zsh', state: 'idle', description: 'Reproducing 429s' }),
    ],
  },
  {
    key: 'Closed',
    label: 'Closed',
    facts: [
      fact({
        sessionId: 'c',
        name: 'pnpm build',
        isClosed: true,
        state: 'exited',
        description: 'Bundle size check',
        closedAt: '2026-09-15T11:00:00.000Z',
      }),
    ],
  },
]

let props: React.ComponentProps<typeof LedgerView>

beforeEach(() => {
  props = {
    groups,
    columns: DEFAULT_HOME_PREFS.columns,
    previewSelected: true,
    selectedId: null,
    now: NOW,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onSaveDescription: vi.fn(),
  }
})

describe('LedgerView', () => {
  it('is a grid of groups, each holding its sessions as rows', () => {
    render(<LedgerView {...props} />)
    const grid = screen.getByRole('grid', { name: 'Sessions' })
    const northwind = within(grid).getByRole('rowgroup', { name: 'Northwind / northwind-api' })
    expect(within(northwind).getByRole('row', { name: 'claude' })).toBeTruthy()
    expect(within(northwind).getByRole('row', { name: 'zsh' })).toBeTruthy()
    expect(
      within(within(grid).getByRole('rowgroup', { name: 'Closed' })).getByRole('row', {
        name: 'pnpm build',
      })
    ).toBeTruthy()
  })

  it('shows state, branch, work item, latest output and age on a row', () => {
    render(<LedgerView {...props} />)
    const row = screen.getByRole('row', { name: 'claude' })
    expect(within(row).getByRole('img', { name: 'Waiting on you' })).toBeTruthy()
    expect(within(row).getByText('nw-88-rate-limits')).toBeTruthy()
    expect(within(row).getByText('Make this edit?')).toBeTruthy()
    expect(within(row).getByText('2m')).toBeTruthy()
    expect(within(row).getByRole('textbox', { name: 'What is this session doing?' })).toBeTruthy()
  })

  it('draws a header for each visible column', () => {
    render(<LedgerView {...props} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      '',
      'Session',
      'Branch',
      'Work item or description',
      'Latest output',
      'Age',
    ])
  })

  it('selects a row on click', () => {
    render(<LedgerView {...props} />)
    fireEvent.click(screen.getByRole('row', { name: 'zsh' }))
    expect(props.onSelect).toHaveBeenCalledWith('b')
  })

  it('opens the terminal on Enter', () => {
    render(<LedgerView {...props} />)
    fireEvent.keyDown(screen.getByRole('row', { name: 'zsh' }), { key: 'Enter' })
    expect(props.onOpen).toHaveBeenCalledWith('b')
  })

  it('expands the selected row into a live preview with a way into the terminal', () => {
    render(<LedgerView {...props} selectedId="a" />)
    expect(screen.getByRole('row', { name: 'claude' }).getAttribute('aria-selected')).toBe('true')
    const preview = screen.getByRole('region', { name: 'Preview of claude' })
    expect(within(preview).getByTestId('preview-a')).toBeTruthy()
    fireEvent.click(within(preview).getByRole('button', { name: 'Open claude' }))
    expect(props.onOpen).toHaveBeenCalledWith('a')
  })

  it('does not expand a closed session, which has no terminal', () => {
    render(<LedgerView {...props} selectedId="c" />)
    expect(screen.queryByRole('region', { name: 'Preview of pnpm build' })).toBeNull()
  })

  it('shows a closed session read-only', () => {
    render(<LedgerView {...props} />)
    const row = screen.getByRole('row', { name: 'pnpm build' })
    expect(within(row).getByText('Bundle size check')).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Edit description' })).toBeNull()
  })

  it('saves a description against the session it was typed on', () => {
    render(<LedgerView {...props} />)
    const box = within(screen.getByRole('row', { name: 'claude' })).getByRole('textbox', {
      name: 'What is this session doing?',
    })
    fireEvent.change(box, { target: { value: 'Session home view' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(props.onSaveDescription).toHaveBeenCalledWith(groups[0].facts[0], 'Session home view')
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('selects a row with Space without scrolling the page', () => {
    render(<LedgerView {...props} />)
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    screen.getByRole('row', { name: 'zsh' }).dispatchEvent(event)
    expect(props.onSelect).toHaveBeenCalledWith('b')
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not open a closed session on Enter', () => {
    render(<LedgerView {...props} />)
    fireEvent.keyDown(screen.getByRole('row', { name: 'pnpm build' }), { key: 'Enter' })
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('shows tags when that column is on', () => {
    render(<LedgerView {...props} columns={{ ...DEFAULT_HOME_PREFS.columns, tags: true }} />)
    expect(within(screen.getByRole('row', { name: 'claude' })).getByText('client')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Tags')
  })

  it('leaves out a hidden column, header and cells alike', () => {
    render(
      <LedgerView
        {...props}
        columns={{ branch: false, workItem: false, tags: false, latestLine: false, age: false }}
      />
    )
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Session'])
    const row = screen.getByRole('row', { name: 'claude' })
    expect(within(row).queryByText('nw-88-rate-limits')).toBeNull()
    expect(within(row).queryByText('Make this edit?')).toBeNull()
    expect(within(row).getAllByRole('gridcell')).toHaveLength(2)
  })

  it('does not expand the selected row when previews are off', () => {
    render(<LedgerView {...props} selectedId="a" previewSelected={false} />)
    expect(screen.queryByRole('region', { name: 'Preview of claude' })).toBeNull()
  })

  it('offers a link on open sessions only, when linking is possible', () => {
    const onLink = vi.fn()
    render(<LedgerView {...props} onLink={onLink} />)
    fireEvent.click(
      within(screen.getByRole('row', { name: 'claude' })).getByRole('button', {
        name: 'Link a work item',
      })
    )
    expect(onLink).toHaveBeenCalledWith(groups[0].facts[0])
  })

  it("shows a waiting prompt's question as the latest output", () => {
    const waiting = {
      ...groups[0],
      facts: [{ ...groups[0].facts[0], choicePrompt: { question: 'Which runner?', options: [] } }],
    }
    render(<LedgerView {...props} groups={[waiting]} />)
    expect(screen.getByText('Which runner?')).toBeTruthy()
  })

  it('draws answers beside Open in the preview', () => {
    render(
      <LedgerView
        {...props}
        selectedId="a"
        renderAnswers={(f) => <button type="button">answer {f.name}</button>}
      />
    )
    expect(
      within(screen.getByRole('region', { name: 'Preview of claude' })).getByRole('button', {
        name: 'answer claude',
      })
    ).toBeTruthy()
  })

  it('draws a session with no branch without a branch icon', () => {
    const bare = { ...groups[0], facts: [{ ...groups[0].facts[1], branch: null }] }
    const { container } = render(<LedgerView {...props} groups={[bare]} />)
    expect(container.querySelector('.ledger__branch svg')).toBeNull()
  })

  it('offers Resume on a stopped session whose conversation is still there', () => {
    const onResume = vi.fn()
    const stopped = {
      ...groups[0],
      facts: [
        {
          ...groups[0].facts[0],
          state: 'exited' as const,
          agent: {
            provider: 'claude' as const,
            sessionId: 'conv-1',
            transcriptPath: '/t/c.jsonl',
            cwd: '/code/repo',
            capturedAt: '2026-09-15T18:00:00.000Z',
          },
          resumable: true,
        },
      ],
    }
    render(<LedgerView {...props} groups={[stopped]} onResume={onResume} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(onResume).toHaveBeenCalledWith(stopped.facts[0])
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  // The case a restart leaves behind: the tab has gone and the session lives
  // only as a record under Closed, which is exactly where its conversation is
  // most worth picking up.
  it('offers Resume on a closed session, whose description stays readable', () => {
    const onResume = vi.fn()
    const closed = {
      ...groups[0],
      facts: [
        {
          ...groups[0].facts[0],
          isClosed: true,
          state: 'exited' as const,
          description: 'chasing the flaky test',
          closedAt: '2026-09-15T19:00:00.000Z',
          agent: {
            provider: 'claude' as const,
            sessionId: 'conv-1',
            transcriptPath: '/t/c.jsonl',
            cwd: '/code/repo',
            capturedAt: '2026-09-15T18:00:00.000Z',
          },
          resumable: true,
        },
      ],
    }
    render(<LedgerView {...props} groups={[closed]} onResume={onResume} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(onResume).toHaveBeenCalledWith(closed.facts[0])
    expect(screen.getByText('chasing the flaky test')).toBeTruthy()
  })

  it('says when a stopped session’s conversation has gone', () => {
    const gone = {
      ...groups[0],
      facts: [
        {
          ...groups[0].facts[0],
          state: 'exited' as const,
          agent: {
            provider: 'claude' as const,
            sessionId: 'conv-1',
            transcriptPath: '/t/gone.jsonl',
            cwd: '/code/repo',
            capturedAt: '2026-09-15T18:00:00.000Z',
          },
          resumable: false,
        },
      ],
    }
    render(<LedgerView {...props} groups={[gone]} onResume={vi.fn()} />)
    expect(screen.getByText('Conversation no longer available')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull()
  })

  it('offers no Resume on a running session', () => {
    render(<LedgerView {...props} onResume={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull()
  })
})
