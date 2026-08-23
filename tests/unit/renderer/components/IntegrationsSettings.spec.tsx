import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntegrationsSettings } from '../../../../src/renderer/components/settings/IntegrationsSettings'
import type { TrackerConnection } from '../../../../src/shared/types/index'

const api = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  setMine: vi.fn(),
  onStatusChanged: vi.fn(() => () => {}),
}

function connection(over: Partial<TrackerConnection> = {}): TrackerConnection {
  return {
    tracker: 'linear',
    connected: false,
    account: null,
    site: null,
    mine: { kind: 'assignee', email: null },
    lastError: null,
    ...over,
  }
}

const JIRA_DISCONNECTED = connection({
  tracker: 'jira',
  mine: { kind: 'query', jql: 'assignee = currentUser()' },
})

async function renderWith(connections: TrackerConnection[]) {
  api.status.mockResolvedValue({ connections })
  const view = render(<IntegrationsSettings />)
  await waitFor(() => expect(api.status).toHaveBeenCalled())
  return view
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  Object.defineProperty(window, 'electronAPI', {
    value: { integrations: api },
    writable: true,
    configurable: true,
  })
  // A fresh store per test — zustand state is module-level and would otherwise
  // leak a previous test's connections into the next one.
  const { useIntegrationsStore } = await import(
    '../../../../src/renderer/stores/integrations.store'
  )
  useIntegrationsStore.setState({ connections: [], connectError: {}, loading: false })
})

describe('IntegrationsSettings — rendering', () => {
  it('lists both trackers whether or not they are connected', async () => {
    await renderWith([connection(), JIRA_DISCONNECTED])
    expect(screen.getByText('Linear')).toBeTruthy()
    expect(screen.getByText('Jira')).toBeTruthy()
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
  })

  it('names the account a connected credential proved to belong to', async () => {
    await renderWith([
      connection({ connected: true, account: { name: 'Andrew', email: 'a@b.co' } }),
      JIRA_DISCONNECTED,
    ])
    await waitFor(() => expect(screen.getByText(/Connected as a@b.co/)).toBeTruthy())
  })

  it('shows the Jira site alongside the account', async () => {
    await renderWith([
      connection(),
      connection({
        tracker: 'jira',
        connected: true,
        account: { name: 'Andrew', email: 'a@b.co' },
        site: 'tav.atlassian.net',
        mine: { kind: 'query', jql: 'x' },
      }),
    ])
    await waitFor(() => expect(screen.getByText(/tav.atlassian.net/)).toBeTruthy())
  })

  it('says a working credential has started failing rather than showing an empty list', async () => {
    await renderWith([
      connection({
        connected: true,
        account: { name: 'A', email: 'a@b.co' },
        lastError: 'auth-failed',
      }),
      JIRA_DISCONNECTED,
    ])
    await waitFor(() => expect(screen.getByText(/Credential rejected/)).toBeTruthy())
  })

  it('offers the connect form only while disconnected', async () => {
    await renderWith([connection(), JIRA_DISCONNECTED])
    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.queryByText('Disconnect')).toBeNull()
  })

  it('offers disconnect only once connected', async () => {
    await renderWith([
      connection({ connected: true, account: { name: 'A', email: 'a@b.co' } }),
      JIRA_DISCONNECTED,
    ])
    await waitFor(() => expect(screen.getAllByText('Disconnect')).toHaveLength(1))
  })
})

describe('IntegrationsSettings — connecting', () => {
  it('sends the key and clears the field so no secret is left on screen', async () => {
    api.connect.mockResolvedValue({ connection: connection({ connected: true }) })
    await renderWith([connection(), JIRA_DISCONNECTED])

    const input = screen.getByLabelText('API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'lin_api_secret' } })
    fireEvent.click(screen.getByText('Connect Linear'))

    await waitFor(() =>
      expect(api.connect).toHaveBeenCalledWith({
        tracker: 'linear',
        apiKey: 'lin_api_secret',
        email: null,
      })
    )
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('masks the key and keeps it out of autofill history', async () => {
    // A React controlled input necessarily holds its value in the DOM, so the
    // achievable guarantee is: masked on screen, never autofilled, never
    // persisted, and cleared the moment it has been handed over (tested
    // above). It is never written anywhere by this component.
    await renderWith([connection(), JIRA_DISCONNECTED])
    const input = screen.getByLabelText('API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'lin_api_secret' } })

    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(api.status).toHaveBeenCalled()
    // Nothing was sent anywhere just by typing.
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('masks the Jira token too', async () => {
    await renderWith([connection(), JIRA_DISCONNECTED])
    const token = screen.getByLabelText('API token') as HTMLInputElement
    expect(token.type).toBe('password')
    expect(token.getAttribute('autocomplete')).toBe('off')
  })

  it('will not submit an empty key', async () => {
    await renderWith([connection(), JIRA_DISCONNECTED])
    const button = screen.getByText('Connect Linear') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('shows a rejection inline, beside the field that caused it', async () => {
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })
    await renderWith([connection(), JIRA_DISCONNECTED])

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByText('Connect Linear'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Authentication'))
  })

  it('clears the rejection as soon as the operator types again', async () => {
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })
    await renderWith([connection(), JIRA_DISCONNECTED])

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByText('Connect Linear'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'better' } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('requires site, email and token before Jira can be connected', async () => {
    await renderWith([connection(), JIRA_DISCONNECTED])
    const button = screen.getByText('Connect Jira') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'tav.atlassian.net' } })
    expect((screen.getByText('Connect Jira') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok' } })
    expect((screen.getByText('Connect Jira') as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the Jira query along with the credential', async () => {
    api.connect.mockResolvedValue({ connection: JIRA_DISCONNECTED })
    await renderWith([connection(), JIRA_DISCONNECTED])

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'tav.atlassian.net' } })
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByText('Connect Jira'))

    await waitFor(() =>
      expect(api.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          tracker: 'jira',
          site: 'tav.atlassian.net',
          jql: expect.any(String),
        })
      )
    )
  })
})

describe('IntegrationsSettings — connected actions', () => {
  it('disconnects only the tracker asked for', async () => {
    api.disconnect.mockResolvedValue({ ok: true })
    await renderWith([
      connection({ connected: true, account: { name: 'A', email: 'a@b.co' } }),
      JIRA_DISCONNECTED,
    ])

    await waitFor(() => expect(screen.getAllByText('Disconnect')).toHaveLength(1))
    fireEvent.click(screen.getByText('Disconnect'))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith({ tracker: 'linear' }))
  })

  it('stores an edited assignee lookup on blur', async () => {
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([
      connection({ connected: true, account: { name: 'A', email: 'a@b.co' } }),
      JIRA_DISCONNECTED,
    ])

    const input = await screen.findByLabelText('Assigned-issue lookup')
    fireEvent.change(input, { target: { value: 'me@x.co' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(api.setMine).toHaveBeenCalledWith({
        tracker: 'linear',
        mine: { kind: 'assignee', email: 'me@x.co' },
      })
    )
  })

  it('stores an edited JQL on blur', async () => {
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([
      connection(),
      connection({
        tracker: 'jira',
        connected: true,
        account: { name: 'A', email: 'a@b.co' },
        site: 's',
        mine: { kind: 'query', jql: 'old' },
      }),
    ])

    const input = await screen.findByLabelText('My issues (JQL)')
    fireEvent.change(input, { target: { value: 'project = TAV' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(api.setMine).toHaveBeenCalledWith({
        tracker: 'jira',
        mine: { kind: 'query', jql: 'project = TAV' },
      })
    )
  })

  it('re-checks the connection when Test is pressed', async () => {
    await renderWith([
      connection({ connected: true, account: { name: 'A', email: 'a@b.co' } }),
      JIRA_DISCONNECTED,
    ])
    api.status.mockClear()
    fireEvent.click(await screen.findByText('Test'))
    await waitFor(() => expect(api.status).toHaveBeenCalled())
  })
})

describe('IntegrationsSettings — live updates', () => {
  it('subscribes to status changes and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn()
    api.onStatusChanged.mockReturnValue(unsubscribe)
    const { unmount } = await renderWith([connection(), JIRA_DISCONNECTED])

    expect(api.onStatusChanged).toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('survives a status call that fails', async () => {
    api.status.mockResolvedValue({ error: 'failed', message: 'nope' })
    render(<IntegrationsSettings />)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    // Renders the section rather than blanking out.
    expect(screen.getByText('Linear')).toBeTruthy()
  })
})
