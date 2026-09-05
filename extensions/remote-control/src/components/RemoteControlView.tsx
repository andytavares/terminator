import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Eye, EyeOff, Loader, Wifi, WifiOff, TriangleAlert } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import { OFF, reduceStatus, tunnelDropped, type RemoteStatus } from '../state/status'
import type { ConnectedDevice } from '../server/connected-devices'
import { RemoteControlSettings } from './RemoteControlSettings'
import './remote-control-view.css'

/**
 * What Remote Control is doing, and how to reach it.
 *
 * This screen used to be a settings form: an enable checkbox, a port, a viewer
 * cap and a credential field. It could not say whether the server was running,
 * at what address, who was connected, or how to stop it — every question a
 * person opens this tab to ask. Configuration is still here, at the bottom,
 * collapsed until wanted.
 */
export function RemoteControlView(): React.JSX.Element {
  const [status, setStatus] = useState<RemoteStatus>(OFF)
  const [devices, setDevices] = useState<ConnectedDevice[]>([])
  const [password, setPassword] = useState('')
  const [maxViewers, setMaxViewers] = useState(5)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const offStatus = window.electronAPI.extensionBridge.on('remote:status', (data) => {
      setStatus((previous) => reduceStatus(previous, data as Parameters<typeof reduceStatus>[1]))
    })
    const offDropped = window.electronAPI.extensionBridge.on('remote:tunnel-disconnected', () => {
      setStatus(tunnelDropped)
    })
    const offDevices = window.electronAPI.extensionBridge.on('remote:devices', (data) => {
      setDevices((data as { devices?: ConnectedDevice[] })?.devices ?? [])
    })
    void window.electronAPI.extensionBridge.invoke('remote:get-settings', {}).then((res) => {
      const s = res as {
        enabled?: boolean
        port?: number
        password?: string
        maxSubscribers?: number
        lanUrl?: string
        publicUrl?: string | null
      } | null
      if (!s) return
      setPassword(s.password ?? '')
      setMaxViewers(s.maxSubscribers ?? 5)
      setStatus((previous) =>
        reduceStatus(previous, {
          enabled: s.enabled,
          port: s.port,
          lanUrl: s.lanUrl,
          publicUrl: s.publicUrl,
        })
      )
    })
    return () => {
      offStatus()
      offDropped()
      offDevices()
    }
  }, [])

  const toggle = useCallback(async (next: boolean) => {
    setBusy(true)
    if (next) setStatus((p) => (p.kind === 'off' ? { kind: 'starting', port: 7681 } : p))
    try {
      await window.electronAPI.extensionBridge.invoke('remote:toggle', { enabled: next })
    } finally {
      setBusy(false)
    }
  }, [])

  const disconnect = useCallback(async (id: string) => {
    await window.electronAPI.extensionBridge.invoke('remote:disconnect-device', { id })
  }, [])

  return (
    <div className="rc">
      <StatusBand status={status} busy={busy} onToggle={toggle} password={password} />
      {status.kind === 'on' && (
        <ConnectedDevices devices={devices} maxViewers={maxViewers} onDisconnect={disconnect} />
      )}
      <SettingsSection status={status} maxViewers={maxViewers} />
    </div>
  )
}

// ── The band that answers "is it on, and where" ─────────────────────────────

function StatusBand({
  status,
  busy,
  password,
  onToggle,
}: {
  status: RemoteStatus
  busy: boolean
  password: string
  onToggle: (next: boolean) => void
}): React.JSX.Element {
  if (status.kind === 'off') {
    return (
      <section className="rc-band" data-state="off">
        <div className="rc-band__head">
          <WifiOff aria-hidden="true" className="rc-band__glyph" />
          <div className="rc-band__headline">
            <h2 className="rc-band__title">Off</h2>
            <p className="rc-band__sub">Your terminals are not reachable from any browser.</p>
          </div>
          <button
            type="button"
            className="rc-btn rc-btn--primary"
            disabled={busy}
            onClick={() => onToggle(true)}
          >
            Turn on
          </button>
        </div>
      </section>
    )
  }

  if (status.kind === 'starting') {
    return (
      <section className="rc-band" data-state="starting">
        <div className="rc-band__head">
          <Loader aria-hidden="true" className="rc-band__glyph rc-band__glyph--spin" />
          <div className="rc-band__headline">
            <h2 className="rc-band__title">Starting…</h2>
            <p className="rc-band__sub">Opening port {status.port} and creating an address.</p>
          </div>
          <button type="button" className="rc-btn" disabled={busy} onClick={() => onToggle(false)}>
            Cancel
          </button>
        </div>
      </section>
    )
  }

  if (status.kind === 'failed') {
    return (
      <section className="rc-band" data-state="failed" role="alert">
        <div className="rc-band__head">
          <TriangleAlert aria-hidden="true" className="rc-band__glyph" />
          <div className="rc-band__headline">
            <h2 className="rc-band__title">{status.failure.message}</h2>
            {status.failure.resolution !== null && (
              <p className="rc-band__sub">{status.failure.resolution}</p>
            )}
          </div>
          <button
            type="button"
            className="rc-btn rc-btn--primary"
            disabled={busy}
            onClick={() => onToggle(true)}
          >
            Try again
          </button>
        </div>
      </section>
    )
  }

  const address = status.publicUrl ?? status.localUrl
  return (
    <section className="rc-band" data-state="on">
      <div className="rc-band__head">
        <Wifi aria-hidden="true" className="rc-band__glyph" />
        <div className="rc-band__headline">
          <h2 className="rc-band__title">
            {status.reach === 'public'
              ? 'On — reachable from any browser'
              : 'On — reachable on this network'}
          </h2>
          {status.reach === 'local-only' && (
            <p className="rc-band__sub">
              No public address: add an account token below to reach it from outside this network.
            </p>
          )}
        </div>
        <button
          type="button"
          className="rc-btn rc-btn--danger"
          disabled={busy}
          onClick={() => onToggle(false)}
        >
          Turn off
        </button>
      </div>

      <div className="rc-reach">
        <div className="rc-address">
          <span className="rc-label">Open this on your phone</span>
          <div className="rc-address__row">
            <code className="rc-address__url">{address}</code>
            <CopyButton value={address} label="Copy address" />
          </div>
          <Credential password={password} />
          <p className="rc-consequence">
            Anyone with this address and password can type into your terminals.
          </p>
        </div>
        <ConnectCode url={address} password={password} />
      </div>
    </section>
  )
}

// ── The credential, concealed until asked for ───────────────────────────────

export function Credential({ password }: { password: string }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false)
  if (!password) return <></>
  return (
    <div className="rc-credential">
      <span className="rc-label">Password</span>
      <code className="rc-credential__value" data-revealed={revealed ? '' : undefined}>
        {revealed ? password : '•'.repeat(Math.min(password.length, 18))}
      </code>
      <IconButton
        icon={revealed ? EyeOff : Eye}
        label={revealed ? 'Hide password' : 'Show password'}
        onClick={() => setRevealed((v) => !v)}
      />
      <CopyButton value={password} label="Copy password" />
    </div>
  )
}

// ── The scannable form ──────────────────────────────────────────────────────

/**
 * Encodes the address *and* the password, so the everyday path — point a phone
 * at it — never puts the credential on screen at all.
 */
export function ConnectCode({
  url,
  password,
}: {
  url: string
  password: string
}): React.JSX.Element {
  const value = useMemo(
    () => (password ? `${url}#p=${encodeURIComponent(password)}` : url),
    [url, password]
  )
  return (
    <div className="rc-code">
      <QRCodeSVG
        value={value}
        size={112}
        // Theme tokens, so the code inverts correctly in light mode rather than
        // being a white tile punched into a dark panel.
        bgColor="var(--tm-bg-elevated)"
        fgColor="var(--tm-text-primary)"
        title="Scan to connect this device"
        marginSize={2}
      />
      <span className="rc-code__caption">Scan to connect</span>
    </div>
  )
}

// ── Who is connected ────────────────────────────────────────────────────────

export function ConnectedDevices({
  devices,
  maxViewers,
  onDisconnect,
}: {
  devices: ConnectedDevice[]
  maxViewers: number
  onDisconnect: (id: string) => void
}): React.JSX.Element {
  return (
    <section className="rc-devices">
      <div className="rc-devices__head">
        <h3 className="rc-devices__title">Connected now</h3>
        <span className="rc-count">
          {devices.length} of {maxViewers}
        </span>
      </div>
      {devices.length === 0 ? (
        <p className="rc-devices__none">Nothing connected. Scan the code to add this phone.</p>
      ) : (
        <ul className="rc-devices__list">
          {devices.map((device) => (
            <li key={device.id} className="rc-device">
              <span className="rc-device__label">{device.label}</span>
              <span className="rc-device__viewing">{device.viewing}</span>
              <span className="rc-device__since">{elapsed(device.connectedAt)}</span>
              <button
                type="button"
                className="rc-btn rc-btn--ghost"
                onClick={() => onDisconnect(device.id)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Configuration, demoted ──────────────────────────────────────────────────

function SettingsSection({
  status,
  maxViewers,
}: {
  status: RemoteStatus
  maxViewers: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const port = status.kind === 'off' ? 7681 : status.port
  return (
    <section className="rc-settings">
      <button
        type="button"
        className="rc-settings__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Settings</span>
        <span className="rc-settings__summary">
          port {port} · up to {maxViewers} viewers
        </span>
      </button>
      {open && (
        <div className="rc-settings__body">
          <RemoteControlSettings />
        </div>
      )}
    </section>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="rc-btn rc-btn--ghost"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** Elapsed time, never a raw timestamp. */
export function elapsed(since: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - since) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}
