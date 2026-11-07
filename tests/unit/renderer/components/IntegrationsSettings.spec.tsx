import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { IntegrationsSettings } from '../../../../src/renderer/components/settings/IntegrationsSettings'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import type { TrackerConnection } from '../../../../src/shared/types/index'
import type { ClaudeCodeStatus } from '../../../../src/shared/electron-api/manifest'

const api = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  setMine: vi.fn(),
  onStatusChanged: vi.fn((_handler: (payload: unknown) => void): (() => void) => () => {}),
}

const claudeCode = {
  status: vi.fn<() => Promise<unknown>>(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}

function connection(over: Partial<TrackerConnection> = {}): TrackerConnection {
  return {
    tracker: 'linear',
    connected: false,
    account: null,
    mine: { kind: 'assignee', email: null },
    lastError: null,
    ...over,
  }
}

async function renderWith(connections: TrackerConnection[]) {
  api.status.mockResolvedValue({ connections })
  const view = render(<IntegrationsSettings />)
  await waitFor(() => expect(api.status).toHaveBeenCalled())
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  // Pending, so the Claude Code block stays empty in the tracker tests.
  claudeCode.status.mockReturnValue(new Promise(() => {}))
  Object.defineProperty(window, 'electronAPI', {
    value: { integrations: api, claudeCode },
    writable: true,
    configurable: true,
  })
  // The component imports this same store instance; zustand state is
  // module-level and would otherwise leak into the next test.
  useIntegrationsStore.setState({ connections: [], connectError: {}, loading: false })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('IntegrationsSettings — rendering', () => {
  it('lists the tracker whether or not it is connected', async () => {
    await renderWith([connection()])
    expect(screen.getByText('Linear')).toBeTruthy()
    expect(screen.getAllByText('Not connected')).toHaveLength(1)
  })

  it('names the account a connected credential proved to belong to', async () => {
    await renderWith([
      connection({ connected: true, account: { name: 'Andrew', email: 'a@b.co' } }),
    ])
    await screen.findByText(/Connected as a@b.co/)
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
    ])
    await screen.findByText(/Credential rejected/)
  })

  it('offers the connect form only while disconnected', async () => {
    await renderWith([connection()])
    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.queryByText('Disconnect')).toBeNull()
  })

  it('offers disconnect only once connected', async () => {
    await renderWith([connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })])
    await waitFor(() => expect(screen.getAllByText('Disconnect')).toHaveLength(1))
  })
})

describe('IntegrationsSettings — connecting', () => {
  it('sends the key and clears the field so no secret is left on screen', async () => {
    api.connect.mockResolvedValue({ connection: connection({ connected: true }) })
    await renderWith([connection()])

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
    await renderWith([connection()])
    const input = screen.getByLabelText('API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'lin_api_secret' } })

    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    // Nothing was sent anywhere just by typing.
    expect(api.connect).not.toHaveBeenCalled()
  })
})

describe('IntegrationsSettings — connecting — validation and rejection', () => {
  it('will not submit an empty key', async () => {
    await renderWith([connection()])
    const button = screen.getByText('Connect Linear') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('shows a rejection inline, beside the field that caused it', async () => {
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })
    await renderWith([connection()])

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByText('Connect Linear'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Authentication'))
  })
})

describe('IntegrationsSettings — connecting — clears the rejection as soon as the operator types again', () => {
  it('clears the rejection as soon as the operator types again', async () => {
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })
    await renderWith([connection()])

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByText('Connect Linear'))
    await screen.findByRole('alert')

    fireEvent.change(await screen.findByLabelText('API key'), { target: { value: 'better' } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('IntegrationsSettings — connected actions', () => {
  it('disconnects the tracker', async () => {
    api.disconnect.mockResolvedValue({ ok: true })
    await renderWith([connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })])

    await waitFor(() => expect(screen.getAllByText('Disconnect')).toHaveLength(1))
    fireEvent.click(screen.getByText('Disconnect'))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith({ tracker: 'linear' }))
  })

  it('stores an edited assignee lookup on blur', async () => {
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })])

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

describe('IntegrationsSettings — connected actions — re-checks the connection when Test is pressed', () => {
  it('re-checks the connection when Test is pressed', async () => {
    await renderWith([connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })])
    // The credential has been revoked since the page was drawn.
    api.status.mockResolvedValue({
      connections: [
        connection({
          connected: true,
          account: { name: 'A', email: 'a@b.co' },
          lastError: 'auth-failed',
        }),
      ],
    })
    fireEvent.click(await screen.findByText('Test'))
    await screen.findByText(/Credential rejected/)
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
    const { unmount } = await renderWith([connection()])

    act(() =>
      push!({
        connections: [connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })],
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
  it('says Connected when main proved the credential but named no account', async () => {
    await renderWith([connection({ connected: true })])
    expect(await screen.findByText('Connected')).toBeTruthy()
  })
})

describe('IntegrationsSettings — the less common answers — sends the optional assignee email, trimmed, and clears it once connected', () => {
  it('sends the optional assignee email, trimmed, and clears it once connected', async () => {
    api.connect.mockResolvedValue({ connection: connection({ connected: true }) })
    await renderWith([connection()])
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } })
    fireEvent.change(screen.getByLabelText('Assigned-issue lookup (optional)'), {
      target: { value: '  me@x.co ' },
    })
    fireEvent.click(screen.getByText('Connect Linear'))
    await waitFor(() =>
      expect(api.connect).toHaveBeenCalledWith({ tracker: 'linear', apiKey: 'k', email: 'me@x.co' })
    )
  })
})

describe('IntegrationsSettings — the less common answers — stores a cleared assignee lookup as the key’s own account', () => {
  it('stores a cleared assignee lookup as the key’s own account', async () => {
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([
      connection({ connected: true, mine: { kind: 'assignee', email: 'old@x.co' } }),
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

const command = `claude mcp add-json --scope user terminator '{"type":"stdio"}'`
const claudeStatus = (over: Partial<ClaudeCodeStatus>): { data: ClaudeCodeStatus } => ({
  data: { state: 'connected', name: 'terminator', command, ...over },
})

async function renderClaudeCode(status: Partial<ClaudeCodeStatus>) {
  claudeCode.status.mockResolvedValue(claudeStatus(status))
  api.status.mockResolvedValue({ connections: [connection()] })
  render(<IntegrationsSettings />)
  await screen.findByText('Claude Code')
}

describe('IntegrationsSettings — Claude Code', () => {
  it('says connected sessions can use Terminator tools, and offers Disconnect', async () => {
    await renderClaudeCode({ state: 'connected' })
    expect(
      screen.getByText('Connected. Claude sessions on this Mac can use Terminator tools.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy server command' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('says disconnected sessions cannot, and offers Connect', async () => {
    await renderClaudeCode({ state: 'disconnected' })
    expect(
      screen.getByText('Disconnected. Claude sessions cannot use Terminator tools.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('shows the reason when Claude Code is unavailable, and offers Connect to try again', async () => {
    const reason = 'Claude Code is not installed: Terminator cannot find the claude command.'
    await renderClaudeCode({ state: 'unavailable', reason })
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
  })
})

describe('IntegrationsSettings — Claude Code actions', () => {
  it('disconnects, then shows the status it reads again', async () => {
    await renderClaudeCode({ state: 'connected' })
    claudeCode.disconnect.mockResolvedValue({ data: true })
    claudeCode.status.mockResolvedValue(claudeStatus({ state: 'disconnected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await screen.findByText('Disconnected. Claude sessions cannot use Terminator tools.')
    expect(claudeCode.disconnect).toHaveBeenCalledTimes(1)
  })

  it('connects, then shows the status it reads again', async () => {
    await renderClaudeCode({ state: 'disconnected' })
    claudeCode.connect.mockResolvedValue({ data: true })
    claudeCode.status.mockResolvedValue(claudeStatus({ state: 'connected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText('Connected. Claude sessions on this Mac can use Terminator tools.')
    expect(claudeCode.connect).toHaveBeenCalledTimes(1)
  })
})

describe('IntegrationsSettings — Claude Code server command', () => {
  it('copies the server command and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useToastStore.setState({ toasts: [] })
    await renderClaudeCode({ state: 'connected' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy server command' }))
    })
    expect(writeText).toHaveBeenCalledWith(command)
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ type: 'success', message: 'Copied' })
    )
  })
})

describe('IntegrationsSettings — Claude Code on the remote client', () => {
  it('leaves the block out where the app gives no Claude Code API', async () => {
    window.electronAPI = { integrations: api } as never
    await renderWith([connection()])
    await screen.findByText('Linear')
    expect(screen.queryByText('Claude Code')).toBeNull()
  })
})
