import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { RemoteControlView } from '../../../src/components/RemoteControlView'

// The screen used to be a settings form and could answer none of the three
// questions people open it with: is it on, at what address, and who is
// connected. These assert that it now does.

const handlers = new Map<string, (data: unknown) => void>()
const invoke = vi.fn()

function emit(channel: string, data: unknown): void {
  act(() => {
    handlers.get(channel)?.(data)
  })
}

const SETTINGS = {
  enabled: false,
  port: 7681,
  password: 'yields-brave-otter',
  maxSubscribers: 5,
}

beforeEach(() => {
  handlers.clear()
  invoke.mockReset()
  invoke.mockResolvedValue(SETTINGS)
  Object.defineProperty(window, 'electronAPI', {
    value: {
      extensionBridge: {
        on: (channel: string, handler: (data: unknown) => void) => {
          handlers.set(channel, handler)
          return () => handlers.delete(channel)
        },
        invoke,
      },
    },
    configurable: true,
    writable: true,
  })
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
})

const ON = {
  enabled: true,
  port: 7681,
  lanUrl: 'http://192.168.1.4:7681',
  publicUrl: 'https://tender-lynx-42.ngrok.app',
}

describe('RemoteControlView', () => {
  it('says it is off, and offers one control to turn it on', async () => {
    render(<RemoteControlView />)
    await waitFor(() => expect(screen.getByText('Off')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
  })

  it('says it is starting while the server comes up', async () => {
    render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    emit('remote:status', { enabled: true, port: 7681 })
    expect(screen.getByText('Starting…')).toBeTruthy()
  })

  it('shows the address and a way to stop once it is on', async () => {
    render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    emit('remote:status', ON)
    expect(screen.getByText('On — reachable from any browser')).toBeTruthy()
    expect(screen.getByText('https://tender-lynx-42.ngrok.app')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('distinguishes local-only from public', async () => {
    render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    emit('remote:status', {
      ...ON,
      publicUrl: null,
      ngrokError: 'ngrok requires an auth token — add yours in Settings',
    })
    expect(screen.getByText('On — reachable on this network')).toBeTruthy()
    expect(screen.getByText('http://192.168.1.4:7681')).toBeTruthy()
  })

  describe('the credential', () => {
    it('is concealed until asked for', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      expect(screen.queryByText('yields-brave-otter')).toBeNull()
    })

    it('is revealed by a deliberate action', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
      expect(screen.getByText('yields-brave-otter')).toBeTruthy()
    })

    it('can be copied without being shown', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      fireEvent.click(screen.getByRole('button', { name: 'Copy password' }))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('yields-brave-otter')
      expect(screen.queryByText('yields-brave-otter')).toBeNull()
    })
  })

  it('states in plain language what the address and password permit', async () => {
    render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    emit('remote:status', ON)
    expect(
      screen.getByText('Anyone with this address and password can type into your terminals.')
    ).toBeTruthy()
  })

  it('renders a scannable code that carries the credential', async () => {
    const { container } = render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    emit('remote:status', ON)
    const svg = container.querySelector('svg[role="img"], .rc-code svg')
    expect(svg).toBeTruthy()
    // Scanning must not require revealing the password on screen.
    expect(screen.queryByText('yields-brave-otter')).toBeNull()
  })

  describe('connected devices', () => {
    it('lists what is connected', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      emit('remote:devices', {
        devices: [
          { id: 'a', label: 'iPhone', viewing: 'fix/sidebar-sorting', connectedAt: Date.now() },
        ],
      })
      expect(screen.getByText('iPhone')).toBeTruthy()
      expect(screen.getByText('fix/sidebar-sorting')).toBeTruthy()
    })

    it('offers to disconnect one', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      emit('remote:devices', {
        devices: [{ id: 'a', label: 'iPad', viewing: 'scratch', connectedAt: Date.now() }],
      })
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
      expect(invoke).toHaveBeenCalledWith('remote:disconnect-device', { id: 'a' })
    })

    it('says what to do when nothing is connected yet', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      expect(screen.getByText(/Scan the code to add this phone/)).toBeTruthy()
    })
  })

  describe('failure', () => {
    it('names a port clash and offers a way forward', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', { error: 'PORT_IN_USE', port: 7681 })
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText('Port 7681 is already in use.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    })

    it('reports a dropped tunnel rather than continuing to show a dead address', async () => {
      render(<RemoteControlView />)
      await waitFor(() => screen.getByText('Off'))
      emit('remote:status', ON)
      emit('remote:tunnel-disconnected', {})
      expect(screen.getByText('The public address stopped working.')).toBeTruthy()
      expect(screen.queryByText('https://tender-lynx-42.ngrok.app')).toBeNull()
    })
  })

  it('keeps configuration out of the way until it is wanted', async () => {
    render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    const toggle = screen.getByRole('button', { name: /Settings/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText(/port 7681 · up to 5 viewers/)).toBeTruthy()
  })

  it('turns on through the bridge', async () => {
    render(<RemoteControlView />)
    await waitFor(() => screen.getByText('Off'))
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(invoke).toHaveBeenCalledWith('remote:toggle', { enabled: true })
  })
})
