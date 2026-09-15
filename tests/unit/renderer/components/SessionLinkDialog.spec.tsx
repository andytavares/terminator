import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { IssueSummary } from '../../../../src/shared/types/index'

const integrations = vi.hoisted(() => ({ connected: true }))
const setLink = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const picked = vi.hoisted(() => ({
  issue: { tracker: 'linear', key: 'NW-88', title: 'Rate limit per API key' } as IssueSummary,
}))

vi.mock('../../../../src/renderer/stores/integrations.store', () => ({
  useIntegrationsStore: (select: (s: unknown) => unknown) =>
    select({ isAnyConnected: () => integrations.connected }),
}))
vi.mock('../../../../src/renderer/stores/session-records.store', () => ({
  useSessionRecordsStore: (select: (s: unknown) => unknown) => select({ setLink }),
}))
vi.mock('../../../../src/renderer/stores/modal.store', () => ({ useModalEffect: () => {} }))
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
      <button type="button" onClick={() => onSelect(picked.issue)}>
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

const onClose = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  integrations.connected = true
})

describe('SessionLinkDialog', () => {
  it('links the chosen ticket to this session only, then closes', async () => {
    const facts = fact({ name: 'claude' })
    render(<SessionLinkDialog facts={facts} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Link a work item' })).toBeTruthy()
    const link = screen.getByRole('button', { name: 'Link issue' }) as HTMLButtonElement
    expect(link.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'pick NW-88' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link NW-88' }))
    })
    expect(setLink).toHaveBeenCalledWith(facts.snapshot, { tracker: 'linear', key: 'NW-88' })
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open and says so when the link is refused', async () => {
    setLink.mockResolvedValueOnce(false)
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'pick NW-88' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link NW-88' }))
    })
    expect(screen.getByRole('alert').textContent).toMatch(/Could not link/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("removes the session's own link, which falls back to the branch's", async () => {
    const own = fact({ workItem: { source: 'session', ref: { tracker: 'linear', key: 'NW-91' } } })
    render(<SessionLinkDialog facts={own} onClose={onClose} />)
    expect(screen.getByText(/linked to NW-91/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove session link' }))
    })
    expect(setLink).toHaveBeenCalledWith(own.snapshot, null)
    expect(onClose).toHaveBeenCalled()
  })

  it('offers no removal for a ticket that comes from the branch', () => {
    const inherited = fact({
      workItem: { source: 'project', ref: { tracker: 'linear', key: 'NW-91' } },
    })
    render(<SessionLinkDialog facts={inherited} onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Remove session link' })).toBeNull()
  })

  it('says where to connect a tracker when none is', () => {
    integrations.connected = false
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    expect(screen.getByRole('alert').textContent).toBe(
      'No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.'
    )
    expect(screen.queryByRole('button', { name: 'pick NW-88' })).toBeNull()
  })

  it('closes on Cancel and on the backdrop, not on the dialog itself', () => {
    const { container } = render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.dialog-overlay')!)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('forgets the chosen ticket when the picker is cleared', () => {
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'pick NW-88' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear pick' }))
    expect((screen.getByRole('button', { name: 'Link issue' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('keeps its keys from reaching the row or tile behind it', () => {
    const behind = vi.fn()
    render(
      <div onKeyDown={behind}>
        <SessionLinkDialog facts={fact()} onClose={onClose} />
      </div>
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(behind).not.toHaveBeenCalled()
  })

  it('closes on Escape, wherever the focus is', () => {
    render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once it is gone', () => {
    const { unmount } = render(<SessionLinkDialog facts={fact()} onClose={onClose} />)
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves other keys to the dialog, without reaching the row behind it', () => {
    const behind = vi.fn()
    render(
      <div onKeyDown={behind}>
        <SessionLinkDialog facts={fact()} onClose={onClose} />
      </div>
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' })
    expect(behind).not.toHaveBeenCalled()
  })
})
