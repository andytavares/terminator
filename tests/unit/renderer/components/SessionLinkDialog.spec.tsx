import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IssueSummary } from '../../../../src/shared/types/index'

const picked = vi.hoisted(() => ({ key: 'NW-88', title: 'Rate limit per API key' }))

// The picker searches the tracker and has its own spec; here it hands back one issue.
vi.mock('../../../../src/renderer/components/integrations/IssuePicker', () => ({
  IssuePicker: ({
    onSelect,
    onClear,
  }: {
    onSelect: (i: IssueSummary) => void
    onClear: () => void
  }) => (
    <>
      <button type="button" onClick={() => onSelect(issueSummaryOf(picked))}>
        pick NW-88
      </button>
      <button type="button" onClick={onClear}>
        clear pick
      </button>
    </>
  ),
}))

import { SessionLinkDialog } from '../../../../src/renderer/components/session/SessionLinkDialog'
import { fact } from '../sidebar/fixtures/facts'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import {
  issueSummaryOf,
  sessionRecordOf,
  trackerConnectionOf,
} from '../../../support/renderer-stores'

const onClose = vi.fn()
// The main process's answer to a link write: the record with the link applied.
const setLink = vi.fn<Window['electronAPI']['sessionRecords']['setLink']>(
  async ({ session, link }) => ({ data: sessionRecordOf(session, { link }) })
)
const storedLinkOf = (sessionId: string) =>
  useSessionRecordsStore.getState().records.get(sessionId)?.link

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('electronAPI', { sessionRecords: { setLink } })
  useIntegrationsStore.setState({
    ...useIntegrationsStore.getInitialState(),
    connections: [trackerConnectionOf()],
  })
  useSessionRecordsStore.setState(useSessionRecordsStore.getInitialState(), true)
})

describe('SessionLinkDialog', () => {
  it('links the chosen ticket to this session only, then closes', async () => {
    const user = userEvent.setup()
    const facts = fact({ name: 'claude' })
    render(<SessionLinkDialog facts={facts} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Link a work item' })).toBeTruthy()
    const link = screen.getByRole('button', { name: 'Link issue' }) as HTMLButtonElement
    expect(link.disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'pick NW-88' }))
    await user.click(screen.getByRole('button', { name: 'Link NW-88' }))
    expect(storedLinkOf(facts.sessionId)).toEqual({ tracker: 'linear', key: 'NW-88' })
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open and says so when the link is refused', async () => {
    const user = userEvent.setup()
    setLink.mockResolvedValueOnce({ error: 'write-failed', message: 'disk full' })
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'pick NW-88' }))
    await user.click(screen.getByRole('button', { name: 'Link NW-88' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Could not link/)
    expect(useSessionRecordsStore.getState().records.size).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe("SessionLinkDialog — removes the session's own link, which falls back to the branch's", () => {
  it("removes the session's own link, which falls back to the branch's", async () => {
    const own = fact({ workItem: { source: 'session', ref: { tracker: 'linear', key: 'NW-91' } } })
    useSessionRecordsStore.setState({
      records: new Map([
        [
          own.sessionId,
          sessionRecordOf(own.snapshot, { link: { tracker: 'linear', key: 'NW-91' } }),
        ],
      ]),
    })
    const user = userEvent.setup()
    render(<SessionLinkDialog facts={own} onClose={onClose} />)
    expect(screen.getByText(/linked to NW-91/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Remove session link' }))
    expect(storedLinkOf(own.sessionId)).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })

  it('offers no removal for a ticket that comes from the branch', () => {
    const inherited = fact({
      workItem: { source: 'project', ref: { tracker: 'linear', key: 'NW-91' } },
    })
    render(<SessionLinkDialog facts={inherited} onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Remove session link' })).toBeNull()
  })
})

describe('SessionLinkDialog — says where to connect a tracker when none is', () => {
  it('says where to connect a tracker when none is', () => {
    useIntegrationsStore.setState({ connections: [] })
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    expect(screen.getByRole('alert').textContent).toBe(
      'No issue tracker is connected. Connect Linear in Settings → Integrations.'
    )
    expect(screen.queryByRole('button', { name: 'pick NW-88' })).toBeNull()
  })

  it('closes on Cancel', async () => {
    const user = userEvent.setup()
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('forgets the chosen ticket when the picker is cleared', async () => {
    const user = userEvent.setup()
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'pick NW-88' }))
    await user.click(screen.getByRole('button', { name: 'clear pick' }))
    expect((screen.getByRole('button', { name: 'Link issue' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})

describe('SessionLinkDialog — keeps its keys from reaching the row or tile behind it', () => {
  it.each(['{Enter}', 'a'])(
    'keeps the %s key from reaching the row or tile behind it',
    async (key) => {
      const user = userEvent.setup()
      const behind = vi.fn()
      render(
        <div onKeyDown={behind}>
          <SessionLinkDialog facts={fact()} onClose={onClose} />
        </div>
      )
      await user.tab()
      expect(screen.getByRole('dialog').matches(':focus-within')).toBe(true)
      await user.keyboard(key)
      expect(behind).not.toHaveBeenCalled()
    }
  )
})

describe('SessionLinkDialog — Escape', () => {
  it('closes on Escape, wherever the focus is', async () => {
    const user = userEvent.setup()
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once it is gone', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    unmount()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})
