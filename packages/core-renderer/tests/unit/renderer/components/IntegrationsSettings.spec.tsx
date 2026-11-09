import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntegrationsSettings } from '../../../../src/components/settings/IntegrationsSettings'
import { useIntegrationsStore } from '../../../../src/stores/integrations.store'
import { useToastStore } from '../../../../src/stores/toast.store'
import type { TrackerConnection } from '../../../../../core-shared/src/types/index'
import type {
  ClaudeCodeStatus,
  TermctlStatus,
} from '../../../../../core-shared/src/electron-api/manifest'

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

const termctl = {
  status: vi.fn<() => Promise<unknown>>(),
  install: vi.fn<() => Promise<unknown>>(),
  uninstall: vi.fn<() => Promise<unknown>>(),
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

/** The section is busy while it reads the connections from main. */
const loadState = () =>
  screen.getByRole('region', { name: 'Integrations' }).getAttribute('aria-busy')

async function renderWith(connections: TrackerConnection[]) {
  api.status.mockResolvedValue({ connections })
  const view = render(<IntegrationsSettings />)
  await waitFor(() => expect(loadState()).toBe('false'))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  // Pending, so the Claude Code block stays empty in the tracker tests.
  claudeCode.status.mockReturnValue(new Promise(() => {}))
  termctl.status.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('electronAPI', { integrations: api, claudeCode, termctl })
  // The component imports this same store instance; zustand state is
  // module-level and would otherwise leak into the next test.
  useIntegrationsStore.setState({ connections: [], connectError: {}, loading: false })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

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
    expect(await screen.findAllByText('Disconnect')).toHaveLength(1)
  })
})

describe('IntegrationsSettings — connecting', () => {
  it('sends the key and clears the field so no secret is left on screen', async () => {
    const user = userEvent.setup()
    api.connect.mockResolvedValue({ connection: connection({ connected: true }) })
    await renderWith([connection()])

    const input = screen.getByLabelText('API key') as HTMLInputElement
    await user.type(input, 'lin_api_secret')
    await user.click(screen.getByText('Connect Linear'))

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
    const user = userEvent.setup()
    // A React controlled input necessarily holds its value in the DOM, so the
    // achievable guarantee is: masked on screen, never autofilled, never
    // persisted, and cleared the moment it has been handed over (tested
    // above). It is never written anywhere by this component.
    await renderWith([connection()])
    const input = screen.getByLabelText('API key') as HTMLInputElement
    await user.type(input, 'lin_api_secret')

    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    // Nothing was sent anywhere just by typing.
    expect(api.connect).not.toHaveBeenCalled()
  })
})

describe('IntegrationsSettings — connecting — validation and rejection', () => {
  it('will not submit an empty key', async () => {
    const user = userEvent.setup()
    await renderWith([connection()])
    const button = screen.getByText('Connect Linear') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.click(button)
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('shows a rejection inline, beside the field that caused it', async () => {
    const user = userEvent.setup()
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })
    await renderWith([connection()])

    await user.type(screen.getByLabelText('API key'), 'bad')
    await user.click(screen.getByText('Connect Linear'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Authentication'))
  })
})

describe('IntegrationsSettings — connecting — clears the rejection as soon as the operator types again', () => {
  it('clears the rejection as soon as the operator types again', async () => {
    const user = userEvent.setup()
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })
    await renderWith([connection()])

    await user.type(screen.getByLabelText('API key'), 'bad')
    await user.click(screen.getByText('Connect Linear'))
    await screen.findByRole('alert')

    await user.type(await screen.findByLabelText('API key'), 'better')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('IntegrationsSettings — connected actions', () => {
  it('disconnects the tracker', async () => {
    const user = userEvent.setup()
    api.disconnect.mockResolvedValue({ ok: true })
    await renderWith([connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })])

    await user.click(await screen.findByText('Disconnect'))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith({ tracker: 'linear' }))
  })

  it('stores an edited assignee lookup on blur', async () => {
    const user = userEvent.setup()
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([connection({ connected: true, account: { name: 'A', email: 'a@b.co' } })])

    const input = await screen.findByLabelText('Assigned-issue lookup')
    await user.type(input, 'me@x.co')
    await user.tab()

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
    const user = userEvent.setup()
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
    await user.click(await screen.findByText('Test'))
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
    await waitFor(() => expect(loadState()).toBe('false'))
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
    const user = userEvent.setup()
    api.connect.mockResolvedValue({ connection: connection({ connected: true }) })
    await renderWith([connection()])
    await user.type(screen.getByLabelText('API key'), 'k')
    await user.type(screen.getByLabelText('Assigned-issue lookup (optional)'), '  me@x.co ')
    await user.click(screen.getByText('Connect Linear'))
    await waitFor(() =>
      expect(api.connect).toHaveBeenCalledWith({ tracker: 'linear', apiKey: 'k', email: 'me@x.co' })
    )
  })
})

describe('IntegrationsSettings — the less common answers — stores a cleared assignee lookup as the key’s own account', () => {
  it('stores a cleared assignee lookup as the key’s own account', async () => {
    const user = userEvent.setup()
    api.setMine.mockResolvedValue({ ok: true })
    await renderWith([
      connection({ connected: true, mine: { kind: 'assignee', email: 'old@x.co' } }),
    ])
    const input = await screen.findByLabelText('Assigned-issue lookup')
    await user.clear(input)
    await user.type(input, '  ')
    await user.tab()
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
    const user = userEvent.setup()
    await renderClaudeCode({ state: 'connected' })
    claudeCode.disconnect.mockResolvedValue({ data: true })
    claudeCode.status.mockResolvedValue(claudeStatus({ state: 'disconnected' }))
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await screen.findByText('Disconnected. Claude sessions cannot use Terminator tools.')
    expect(claudeCode.disconnect).toHaveBeenCalledTimes(1)
  })

  it('connects, then shows the status it reads again', async () => {
    const user = userEvent.setup()
    await renderClaudeCode({ state: 'disconnected' })
    claudeCode.connect.mockResolvedValue({ data: true })
    claudeCode.status.mockResolvedValue(claudeStatus({ state: 'connected' }))
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText('Connected. Claude sessions on this Mac can use Terminator tools.')
    expect(claudeCode.connect).toHaveBeenCalledTimes(1)
  })
})

describe('IntegrationsSettings — Claude Code server command', () => {
  it('copies the server command and says so', async () => {
    // userEvent.setup() puts a clipboard stub on navigator and removes it after the test.
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    await renderClaudeCode({ state: 'connected' })
    await user.click(screen.getByRole('button', { name: 'Copy server command' }))
    expect(await navigator.clipboard.readText()).toBe(command)
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

const termctlStatus = (state: TermctlStatus['state']): { data: TermctlStatus } => ({
  data: { state, path: '/usr/local/bin/termctl' },
})

async function renderTermctl(state: TermctlStatus['state']) {
  termctl.status.mockResolvedValue(termctlStatus(state))
  api.status.mockResolvedValue({ connections: [connection()] })
  render(<IntegrationsSettings />)
  await screen.findByText('termctl')
}

describe('IntegrationsSettings — termctl', () => {
  it('says termctl is not installed, and offers Install command', async () => {
    await renderTermctl('not-installed')
    expect(
      screen.getByText("Not installed. Run Terminator's tools from any terminal.")
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install command' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
  })

  it('says where termctl is installed, and offers Uninstall', async () => {
    await renderTermctl('installed')
    expect(screen.getByText('Installed at /usr/local/bin/termctl')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install command' })).toBeNull()
  })

  it('says another program owns the path, and offers no action', async () => {
    await renderTermctl('other')
    expect(screen.getByText('/usr/local/bin/termctl belongs to another program.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install command' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
  })
})

describe('IntegrationsSettings — termctl actions', () => {
  it('installs, then shows the status it reads again', async () => {
    const user = userEvent.setup()
    await renderTermctl('not-installed')
    termctl.install.mockResolvedValue({ data: true })
    termctl.status.mockResolvedValue(termctlStatus('installed'))
    await user.click(screen.getByRole('button', { name: 'Install command' }))
    await screen.findByText('Installed at /usr/local/bin/termctl')
    expect(termctl.install).toHaveBeenCalledTimes(1)
  })

  it('uninstalls, then shows the status it reads again', async () => {
    const user = userEvent.setup()
    await renderTermctl('installed')
    termctl.uninstall.mockResolvedValue({ data: true })
    termctl.status.mockResolvedValue(termctlStatus('not-installed'))
    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    await screen.findByText("Not installed. Run Terminator's tools from any terminal.")
    expect(termctl.uninstall).toHaveBeenCalledTimes(1)
  })

  it('shows why an install failed in the status line', async () => {
    const user = userEvent.setup()
    await renderTermctl('not-installed')
    termctl.install.mockResolvedValue({ error: 'failed', message: 'User canceled.' })
    await user.click(screen.getByRole('button', { name: 'Install command' }))
    await screen.findByText('User canceled.')
  })
})
