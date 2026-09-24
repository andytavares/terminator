import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import type { IssueSummary } from '../../../../src/shared/types/index'

const integrations = vi.hoisted(() => ({
  connected: true,
  listMine: vi.fn(),
  issueFor: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/session/LivePreview', () => ({
  LivePreview: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`preview-${sessionId}`} />
  ),
}))
vi.mock('../../../../src/renderer/stores/integrations.store', () => ({
  useIntegrationsStore: (select: (s: unknown) => unknown) =>
    select({
      isAnyConnected: () => integrations.connected,
      listMine: integrations.listMine,
      issueFor: integrations.issueFor,
    }),
}))

import { LogbookView } from '../../../../src/renderer/components/home/LogbookView'
import { buildLogbook } from '../../../../src/renderer/sidebar/logbook-groups'
import { fact } from '../sidebar/fixtures/facts'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')
const titles = new Map([['linear:NW-88', 'Rate limit per API key']])
const issue = (key: string, title: string): IssueSummary =>
  ({
    tracker: 'linear',
    key,
    title,
    state: { name: 'In Progress', type: 'started' },
  }) as IssueSummary

const undescribed = fact({
  sessionId: 'u',
  name: 'zsh',
  state: 'idle',
  workspaceName: 'Northwind',
  projectName: 'northwind-api',
  branch: 'main',
  shell: '/bin/zsh',
  tags: ['client'],
  startedAt: '2026-09-15T10:02:00.000Z',
})
const linked = fact({
  sessionId: 'l',
  name: 'claude',
  state: 'awaiting-input',
  workItem: { source: 'project', ref: { tracker: 'linear', key: 'NW-88' } },
})
const closed = fact({
  sessionId: 'c',
  name: 'pnpm build',
  isClosed: true,
  state: 'exited',
  description: 'Bundle size check',
  closedAt: '2026-09-15T11:00:00.000Z',
})
const facts = [undescribed, linked, closed]

let props: React.ComponentProps<typeof LogbookView>

beforeEach(() => {
  vi.clearAllMocks()
  integrations.connected = true
  integrations.listMine.mockResolvedValue({
    issues: [issue('NW-84', '429s under light load')],
    failures: [],
  })
  integrations.issueFor.mockReturnValue(null)
  props = {
    groups: buildLogbook(facts, '', titles),
    selected: null,
    titles,
    now: NOW,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onSaveDescription: vi.fn(),
    onLinkIssue: vi.fn(),
  }
})

describe('LogbookView — the list', () => {
  it('lists sessions under their state, headlined by what they are for', () => {
    render(<LogbookView {...props} />)
    const list = screen.getByRole('listbox', { name: 'Sessions' })
    const needs = within(list).getByRole('group', { name: 'Needs you' })
    expect(within(needs).getByRole('option', { name: /Rate limit per API key/ })).toBeTruthy()
    expect(
      within(within(list).getByRole('group', { name: 'Running' })).getByRole('option', {
        name: /Add a description/,
      })
    ).toBeTruthy()
    expect(
      within(within(list).getByRole('group', { name: 'Closed' })).getByRole('option', {
        name: /Bundle size check/,
      })
    ).toBeTruthy()
  })

  it('selects an entry by click or keyboard', () => {
    render(<LogbookView {...props} />)
    fireEvent.click(screen.getByRole('option', { name: /Rate limit/ }))
    fireEvent.keyDown(screen.getByRole('option', { name: /Bundle size/ }), { key: 'Enter' })
    expect(props.onSelect).toHaveBeenNthCalledWith(1, 'l')
    expect(props.onSelect).toHaveBeenNthCalledWith(2, 'c')
  })

  it('says to pick a session when none is selected', () => {
    render(<LogbookView {...props} />)
    expect(screen.getByText('Select a session to see what it is for')).toBeTruthy()
  })
})

describe('LogbookView — the detail of an open session', () => {
  it('shows where it lives, its facts and its live terminal', () => {
    render(<LogbookView {...props} selected={undescribed} />)
    const detail = screen.getByRole('region', { name: 'Session details' })
    expect(within(detail).getByText('Northwind / northwind-api / main')).toBeTruthy()
    expect(within(detail).getByText('/bin/zsh')).toBeTruthy()
    expect(within(detail).getByText('client')).toBeTruthy()
    expect(within(detail).getByTestId('preview-u')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: 'Open zsh' }))
    expect(props.onOpen).toHaveBeenCalledWith('u')
  })

  it('puts the cursor in the description when the session has none', () => {
    render(<LogbookView {...props} selected={undescribed} />)
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'What is this session doing?' })
    )
  })

  it('saves what was written', () => {
    render(<LogbookView {...props} selected={undescribed} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'What is this session doing?' }), {
      target: { value: '  Reproducing the staging 429s  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }))
    expect(props.onSaveDescription).toHaveBeenCalledWith(
      undescribed,
      'Reproducing the staging 429s'
    )
  })

  it('saves with Cmd+Enter, and clears with an empty box', () => {
    render(<LogbookView {...props} selected={{ ...undescribed, description: 'old' }} />)
    const box = screen.getByRole('textbox', { name: 'What is this session doing?' })
    expect((box as HTMLTextAreaElement).value).toBe('old')
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(props.onSaveDescription).toHaveBeenCalledWith(
      { ...undescribed, description: 'old' },
      null
    )
  })

  it('shows the ticket it works on, and says whose link that is', () => {
    render(<LogbookView {...props} selected={linked} />)
    const detail = screen.getByRole('region', { name: 'Session details' })
    expect(within(detail).getByText('NW-88')).toBeTruthy()
    expect(within(detail).getByText("From the branch's link")).toBeTruthy()
  })

  it('suggests tickets and links one in a click', async () => {
    render(<LogbookView {...props} selected={undescribed} />)
    const suggestions = await screen.findByRole('list', { name: 'Suggested work items' })
    fireEvent.click(
      within(suggestions).getByRole('button', { name: 'NW-84 429s under light load' })
    )
    expect(props.onLinkIssue).toHaveBeenCalledWith(
      undescribed,
      expect.objectContaining({ key: 'NW-84' })
    )
  })

  it("offers the branch's own ticket first when the session is linked elsewhere", async () => {
    integrations.issueFor.mockReturnValue(issue('P-1', 'Project ticket'))
    const own = {
      ...undescribed,
      projectId: 'p1',
      workItem: { source: 'session' as const, ref: { tracker: 'linear' as const, key: 'NW-99' } },
    }
    render(<LogbookView {...props} selected={own} />)
    const suggestions = await screen.findByRole('list', { name: 'Suggested work items' })
    expect(within(suggestions).getAllByRole('button')[0].getAttribute('aria-label')).toBe(
      'P-1 Project ticket'
    )
  })

  it('suggests nothing when no tracker is connected', async () => {
    integrations.connected = false
    render(<LogbookView {...props} selected={undescribed} />)
    await waitFor(() => expect(integrations.listMine).not.toHaveBeenCalled())
    expect(screen.queryByRole('list', { name: 'Suggested work items' })).toBeNull()
  })

  it('offers linking when it is possible here', () => {
    const onLink = vi.fn()
    render(<LogbookView {...props} selected={undescribed} onLink={onLink} />)
    fireEvent.click(screen.getByRole('button', { name: 'Link a work item' }))
    expect(onLink).toHaveBeenCalledWith(undescribed)
  })

  it('draws answers for a waiting prompt', () => {
    render(
      <LogbookView
        {...props}
        selected={linked}
        renderAnswers={() => <button type="button">1. Yes</button>}
      />
    )
    expect(screen.getByRole('button', { name: '1. Yes' })).toBeTruthy()
  })
})

describe('LogbookView — the detail of a closed session', () => {
  it('shows what it was for and when it closed, with nothing to edit or open', () => {
    render(<LogbookView {...props} selected={closed} />)
    const detail = screen.getByRole('region', { name: 'Session details' })
    expect(within(detail).getByText('Bundle size check')).toBeTruthy()
    expect(within(detail).getByText(/^Closed/)).toBeTruthy()
    expect(within(detail).queryByRole('textbox')).toBeNull()
    expect(within(detail).queryByRole('button', { name: 'Open pnpm build' })).toBeNull()
    expect(within(detail).queryByTestId('preview-c')).toBeNull()
  })

  it('offers Resume on the selected stopped session', () => {
    const onResume = vi.fn()
    const stopped = {
      ...undescribed,
      state: 'exited' as const,
      agent: {
        provider: 'claude' as const,
        sessionId: 'conv-1',
        transcriptPath: '/t/c.jsonl',
        cwd: '/code/repo',
        capturedAt: '2026-09-15T18:00:00.000Z',
      },
      resumable: true,
    }
    render(<LogbookView {...props} selected={stopped} onResume={onResume} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume zsh' }))
    expect(onResume).toHaveBeenCalledWith(stopped)
  })

  it('ends the selected session', () => {
    const onCloseSession = vi.fn()
    render(<LogbookView {...props} selected={undescribed} onCloseSession={onCloseSession} />)
    fireEvent.click(screen.getByRole('button', { name: /^Close / }))
    expect(onCloseSession).toHaveBeenCalledWith(undescribed)
  })

  it('says when a stopped session’s conversation has gone', () => {
    render(
      <LogbookView
        {...props}
        selected={{
          ...undescribed,
          state: 'exited',
          agent: {
            provider: 'claude',
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
  })
})
