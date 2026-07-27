import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DigestPanel } from '../../../../src/renderer/components/supervision/DigestPanel.js'

// FR-028. Routine progress is deferred to a digest rather than interrupting.
// That is only a discipline if the digest is somewhere the operator can read
// it — batching progress and never showing it is the same as dropping it.

const digest = {
  from: 0,
  to: 3_600_000,
  entryCount: 3,
  sessionCount: 2,
  bySession: [
    {
      sessionId: 's1',
      entries: [
        {
          id: 'e1',
          at: 1_000,
          sessionId: 's1',
          author: 'agent' as const,
          summary: 'ran the tests',
          replyable: true,
        },
        {
          id: 'e2',
          at: 2_000,
          sessionId: 's1',
          author: 'agent' as const,
          summary: 'opened a PR',
          replyable: true,
        },
      ],
    },
    {
      sessionId: 's2',
      entries: [
        {
          id: 'e3',
          at: 1_500,
          sessionId: 's2',
          author: 'agent' as const,
          summary: 'installed deps',
          replyable: true,
        },
      ],
    },
  ],
}

describe('DigestPanel', () => {
  it('summarises how much happened and across how many sessions', () => {
    render(<DigestPanel digest={digest} windowMinutes={60} onRefresh={() => {}} />)
    expect(screen.getByText(/3 updates across 2 sessions/)).toBeDefined()
  })

  it('groups the entries under their session', () => {
    render(<DigestPanel digest={digest} windowMinutes={60} onRefresh={() => {}} />)
    expect(screen.getByText('ran the tests')).toBeDefined()
    expect(screen.getByText('opened a PR')).toBeDefined()
    expect(screen.getByText('installed deps')).toBeDefined()
  })

  it('states there was no progress rather than rendering nothing (FR-024)', () => {
    render(<DigestPanel digest={null} windowMinutes={60} onRefresh={() => {}} />)
    expect(screen.getByText(/No routine progress in this window/)).toBeDefined()
  })

  it('says so for an empty window too, not only a missing digest', () => {
    render(
      <DigestPanel
        digest={{ from: 0, to: 1, entryCount: 0, sessionCount: 0, bySession: [] }}
        windowMinutes={60}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByText(/No routine progress in this window/)).toBeDefined()
  })

  it('names the window in hours when it is an hour or more', () => {
    render(<DigestPanel digest={digest} windowMinutes={60} onRefresh={() => {}} />)
    expect(screen.getByText(/last 1 hour/)).toBeDefined()
  })

  it('names a multi-hour window in the plural', () => {
    render(<DigestPanel digest={digest} windowMinutes={180} onRefresh={() => {}} />)
    expect(screen.getByText(/last 3 hours/)).toBeDefined()
  })

  it('names a short window in minutes', () => {
    render(<DigestPanel digest={digest} windowMinutes={15} onRefresh={() => {}} />)
    expect(screen.getByText(/last 15 minutes/)).toBeDefined()
  })

  it('says "1 update" and "1 session" in the singular', () => {
    render(
      <DigestPanel
        digest={{ ...digest, entryCount: 1, sessionCount: 1, bySession: [digest.bySession[1]] }}
        windowMinutes={60}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByText(/1 update across 1 session/)).toBeDefined()
  })

  it('refreshes on request', () => {
    const onRefresh = vi.fn()
    render(<DigestPanel digest={digest} windowMinutes={60} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByText('Refresh'))
    expect(onRefresh).toHaveBeenCalled()
  })
})
