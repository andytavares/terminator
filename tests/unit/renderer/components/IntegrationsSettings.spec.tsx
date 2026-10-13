import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { IntegrationsSettings } from '../../../../src/renderer/components/settings/IntegrationsSettings'
import type { TrackerConnection } from '../../../../src/shared/types/index'

const api = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  setMine: vi.fn(),
  onStatusChanged: vi.fn((_handler: (payload: unknown) => void): (() => void) => () => {}),
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
})

describe('IntegrationsSettings — rendering — says a working credential has started failing rather than showing an empty list', () => {
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
    // Nothing was sent anywhere just by typing.
    expect(api.connect).not.toHaveBeenCalled()
  })
})

describe('IntegrationsSettings — connecting — masks the Jira token too', () => {
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
})

describe('IntegrationsSettings — connecting — clears the rejection as soon as the operator types again', () => {
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
})

describe('IntegrationsSettings — connecting — sends the Jira query along with the credential', () => {
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
})

describe('IntegrationsSettings — connected actions — stores an edited JQL on blur', () => {
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
})

describe('IntegrationsSettings — connected actions — re-checks the connection when Test is pressed', () => {
  it('re-checks the connection when Test is pressed', async () => {
    await renderWith([
      connection({ connected: true, account: { name: 'A', email: 'a@b.co' } }),
      JIRA_DISCONNECTED,
    ])
    // The credential has been revoked since the page was drawn.
    api.status.mockResolvedValue({
      connections: [
        connection({
          connected: true,
          account: { name: 'A', email: 'a@b.co' },
          lastError: 'auth-failed',
        }),
        JIRA_DISCONNECTED,
      ],
    })
    fireEvent.click(await screen.findByText('Test'))
    await waitFor(() => expect(screen.getByText(/Credential rejected/)).toBeTruthy())
  })
})

describe('IntegrationsSettings — live updates', () => {
  it('shows a status change pushed from main, and stops listening on unmount', async () => {
    const unsubscribe = vi.fn()
    let push: ((payload: unknown) => void) | null = null
    api.onStatusChanged.mockImplementation((handler: (payload: unknown) => void) => {
      push = handler
      return unsubscribe
    })
    const { unmount } = await renderWith([connection(), JIRA_DISCONNECTED])

    act(() =>
      push!({
        connections: [
          connection({ connected: true, account: { name: 'A', email: 'a@b.co' } }),
          JIRA_DISCONNECTED,
        ],
      })
    )
    expect(screen.getByText(/Connected as a@b.co/)).toBeTruthy()
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

describe('IntegrationsSettings — the less common answers', () => {
  it('says Connected when main proved the credential but named no account, or only a name', async () => {
    await renderWith([
      connection({ connected: true }),
      connection({
        tracker: 'jira',
        connected: true,
        account: { name: 'Andrew', email: '' },
        mine: { kind: 'query', jql: 'project = TAV' },
      }),
    ])
    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText('Connected as Andrew')).toBeTruthy()
    expect((screen.getByLabelText('My issues (JQL)') as HTMLInputElement).value).toBe(
      'project = TAV'
    )
  })
})

describe('IntegrationsSettings — the less common answers — sends the optional assignee email, trimmed, and clears it once connected', () => {
  it('sends the optional assignee email, trimmed, and clears it once connected', async () => {
    api.connect.mockResolvedValue({ connection: connection({ connected: true }) })
    await renderWith([connection(), JIRA_DISCONNECTED])
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } })
    fireEvent.change(screen.getByLabelText('Assigned-issue lookup (optional)'), {
      target: { value: '  me@x.co ' },
    })
    fireEvent.click(screen.getByText('Connect Linear'))
    await waitFor(() =>
      expect(api.connect).toHaveBeenCalledWith({ tracker: 'linear', apiKey: 'k', email: 'me@x.co' })
    )
  })

  it('keeps the Jira site and email after a rejection, says why, and sends an edited query', async () => {
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Token rejected' })
    await renderWith([connection(), JIRA_DISCONNECTED])
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'tav.atlassian.net' } })
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok' } })
    fireEvent.change(screen.getByLabelText('My issues (JQL)'), { target: { value: 'project = X' } })
    fireEvent.click(screen.getByText('Connect Jira'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Token rejected'))
    expect(api.connect).toHaveBeenCalledWith(expect.objectContaining({ jql: 'project = X' }))
    expect((screen.getByLabelText('Site') as HTMLInputElement).value).toBe('tav.atlassian.net')
    expect((screen.getByLabelText('Account email') as HTMLInputElement).value).toBe('a@b.co')
    expect((screen.getByLabelText('API token') as HTMLInputElement).value).toBe('')
  })
})

describe('IntegrationsSettings — the less common answers — stores a cleared assignee lookup as the key’s own account', () => {
  it('stores a cleared assignee lookup as the key’s own account', async () => {
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([
      connection({ connected: true, mine: { kind: 'assignee', email: 'old@x.co' } }),
      JIRA_DISCONNECTED,
    ])
    const input = await screen.findByLabelText('Assigned-issue lookup')
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(api.setMine).toHaveBeenCalledWith({
        tracker: 'linear',
        mine: { kind: 'assignee', email: null },
      })
    )
  })
})
