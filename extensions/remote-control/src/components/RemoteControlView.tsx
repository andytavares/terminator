import React, { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button, RelativeTime } from '@terminator/extension-ui'
import { ChevronDown, ChevronRight, Loader, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { OFF, reduceStatus, tunnelDropped, type RemoteStatus } from '../state/status'
import type { ConnectedDevice } from '../server/connected-devices'
import { RemoteControlSettings } from './RemoteControlSettings'
import './remote-control-view.css'

type StatusUpdate = React.Dispatch<React.SetStateAction<RemoteStatus>>

interface StoredSettings {
  enabled?: boolean
  port?: number
  maxSubscribers?: number
  lanUrl?: string
  publicUrl?: string | null
}

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
  const [maxViewers, setMaxViewers] = useState(5)

  useEffect(() => {
    const unsubscribe = subscribeToRemote(setStatus, setDevices)
    loadStoredSettings(setStatus, setMaxViewers)
    return unsubscribe
  }, [])

  const disconnect = useCallback(async (id: string) => {
    await window.electronAPI.extensionBridge.invoke('remote:disconnect-device', { id })
  }, [])

  return (
    <div className="rc">
      <StatusBand status={status} setStatus={setStatus} />
      {status.kind === 'on' && (
        <ConnectedDevices devices={devices} maxViewers={maxViewers} onDisconnect={disconnect} />
      )}
      <SettingsSection status={status} maxViewers={maxViewers} onViewersSaved={setMaxViewers} />
    </div>
  )
}

/** Follow the server's status, tunnel and device broadcasts; returns the unsubscribe. */
function subscribeToRemote(
  setStatus: StatusUpdate,
  setDevices: (devices: ConnectedDevice[]) => void
): () => void {
  const bridge = window.electronAPI.extensionBridge
  const offStatus = bridge.on('remote:status', (data) => {
    setStatus((previous) => reduceStatus(previous, data as Parameters<typeof reduceStatus>[1]))
  })
  const offDropped = bridge.on('remote:tunnel-disconnected', () => {
    setStatus(tunnelDropped)
  })
  const offDevices = bridge.on('remote:devices', (data) => {
    setDevices((data as { devices?: ConnectedDevice[] })?.devices ?? [])
  })
  return () => {
    offStatus()
    offDropped()
    offDevices()
  }
}

function loadStoredSettings(setStatus: StatusUpdate, setMaxViewers: (max: number) => void): void {
  void window.electronAPI.extensionBridge.invoke('remote:get-settings', {}).then((res) => {
    const s = res as StoredSettings | null
    if (!s) return
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
}

// ── The band that answers "is it on, and where" ─────────────────────────────

interface BandProps {
  busy: boolean
  onToggle: (next: boolean) => void
}

function StatusBand(props: { status: RemoteStatus; setStatus: StatusUpdate }): React.JSX.Element {
  const { status, setStatus } = props
  const [busy, setBusy] = useState(false)

  const onToggle = useCallback(
    async (next: boolean) => {
      setBusy(true)
      if (next) setStatus((p) => (p.kind === 'off' ? { kind: 'starting', port: 7681 } : p))
      try {
        await window.electronAPI.extensionBridge.invoke('remote:toggle', { enabled: next })
      } finally {
        setBusy(false)
      }
    },
    [setStatus]
  )

  if (status.kind === 'off') return <OffBand busy={busy} onToggle={onToggle} />
  if (status.kind === 'starting')
    return <StartingBand port={status.port} busy={busy} onToggle={onToggle} />
  if (status.kind === 'failed')
    return <FailedBand status={status} busy={busy} onToggle={onToggle} />
  return <OnBand status={status} busy={busy} onToggle={onToggle} />
}

function OffBand({ busy, onToggle }: BandProps): React.JSX.Element {
  return (
    <section className="rc-band" data-state="off">
      <div className="rc-band__head">
        <WifiOff aria-hidden="true" className="rc-band__glyph" />
        <div className="rc-band__headline">
          <h2 className="rc-band__title">Off</h2>
          <p className="rc-band__sub">Your terminals are not reachable from any browser.</p>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => onToggle(true)}>
          Turn on
        </Button>
      </div>
    </section>
  )
}

function StartingBand(props: BandProps & { port: number }): React.JSX.Element {
  const { port, busy, onToggle } = props
  return (
    <section className="rc-band" data-state="starting">
      <div className="rc-band__head">
        <Loader aria-hidden="true" className="rc-band__glyph rc-band__glyph--spin" />
        <div className="rc-band__headline">
          <h2 className="rc-band__title">Starting…</h2>
          <p className="rc-band__sub">Opening port {port} and creating an address.</p>
        </div>
        <Button disabled={busy} onClick={() => onToggle(false)}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

type FailedStatus = Extract<RemoteStatus, { kind: 'failed' }>
type OnStatus = Extract<RemoteStatus, { kind: 'on' }>

function FailedBand(props: BandProps & { status: FailedStatus }): React.JSX.Element {
  const { failure } = props.status
  return (
    <section className="rc-band" data-state="failed" role="alert">
      <div className="rc-band__head">
        <TriangleAlert aria-hidden="true" className="rc-band__glyph" />
        <div className="rc-band__headline">
          <h2 className="rc-band__title">{failure.message}</h2>
          {failure.resolution !== null && <p className="rc-band__sub">{failure.resolution}</p>}
        </div>
        {failure.reason.startsWith('tunnel-') ? (
          <ReconnectButton />
        ) : (
          <Button variant="primary" disabled={props.busy} onClick={() => props.onToggle(true)}>
            Try again
          </Button>
        )}
      </div>
    </section>
  )
}

/** Only the public address failed: the server still listens and devices on this network stay
 *  connected. Reconnecting the tunnel keeps them; turning the server off and on would not. */
function ReconnectButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const reconnect = async () => {
    setBusy(true)
    try {
      await window.electronAPI.extensionBridge.invoke('remote:tunnel-reconnect', {})
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="primary" disabled={busy} onClick={reconnect}>
      Reconnect
    </Button>
  )
}

function OnBand(props: BandProps & { status: OnStatus }): React.JSX.Element {
  const { status, busy, onToggle } = props
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
        <Button variant="danger" disabled={busy} onClick={() => onToggle(false)}>
          Turn off
        </Button>
      </div>
      <ReachPanel address={status.publicUrl ?? status.localUrl} />
    </section>
  )
}

function ReachPanel({ address }: { address: string }): React.JSX.Element {
  return (
    <div className="rc-reach">
      <div className="rc-address">
        <span className="rc-label">Open this on your phone</span>
        <div className="rc-address__row">
          <code className="rc-address__url">{address}</code>
          <CopyButton value={address} label="Copy address" />
        </div>
        <p className="rc-consequence">
          Anyone with this address and password can type into your terminals.
        </p>
      </div>
      <ConnectCode url={address} />
    </div>
  )
}

// ── The scannable form ──────────────────────────────────────────────────────

// Theme tokens, so the code inverts correctly in light mode rather than
// being a white tile punched into a dark panel.
const QR_THEME_COLORS = { bgColor: 'var(--tm-bg-elevated)', fgColor: 'var(--tm-text-primary)' }

/**
 * Encodes the address only. The password is never in the code: the phone opens
 * the login page and the person types it, so a photo of the screen is not a key.
 */
function ConnectCode({ url }: { url: string }): React.JSX.Element {
  return (
    <div className="rc-code">
      <QRCodeSVG
        value={url}
        size={112}
        {...QR_THEME_COLORS}
        title="Scan to connect this device"
        marginSize={2}
      />
      <span className="rc-code__caption">Scan to connect</span>
    </div>
  )
}

// ── Who is connected ────────────────────────────────────────────────────────

interface ConnectedDevicesProps {
  devices: ConnectedDevice[]
  maxViewers: number
  onDisconnect: (id: string) => void
}

interface DeviceRowProps {
  device: ConnectedDevice
  onDisconnect: (id: string) => void
}

function ConnectedDevices(props: ConnectedDevicesProps): React.JSX.Element {
  const { devices, maxViewers, onDisconnect } = props
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
            <DeviceRow key={device.id} device={device} onDisconnect={onDisconnect} />
          ))}
        </ul>
      )}
    </section>
  )
}

function DeviceRow(props: DeviceRowProps): React.JSX.Element {
  const { device, onDisconnect } = props
  return (
    <li className="rc-device">
      <span className="rc-device__label">{device.label}</span>
      <span className="rc-device__viewing">{device.viewing}</span>
      <span className="rc-device__since">
        <RelativeTime value={device.connectedAt} />
      </span>
      <Button variant="ghost" size="sm" onClick={() => onDisconnect(device.id)}>
        Disconnect
      </Button>
    </li>
  )
}

// ── Configuration, demoted ──────────────────────────────────────────────────

interface SettingsSectionProps {
  status: RemoteStatus
  maxViewers: number
  onViewersSaved: (max: number) => void
}

function SettingsSection(props: SettingsSectionProps): React.JSX.Element {
  const { status, maxViewers, onViewersSaved } = props
  const [open, setOpen] = useState(false)
  const port = status.kind === 'off' ? 7681 : status.port
  return (
    <section className="rc-settings">
      <SettingsToggle open={open} onToggle={() => setOpen((v) => !v)}>
        port {port} · up to {maxViewers} viewers
      </SettingsToggle>
      {open && (
        <div className="rc-settings__body">
          <RemoteControlSettings onViewersSaved={onViewersSaved} />
        </div>
      )}
    </section>
  )
}

interface SettingsToggleProps {
  open: boolean
  onToggle: () => void
  /** The one-line summary of the current settings. */
  children: React.ReactNode
}

function SettingsToggle({ open, onToggle, children }: SettingsToggleProps): React.JSX.Element {
  const Caret = open ? ChevronDown : ChevronRight
  return (
    <button type="button" className="rc-settings__toggle" aria-expanded={open} onClick={onToggle}>
      <Caret aria-hidden="true" className="rc-settings__caret" />
      <span>Settings</span>
      <span className="rc-settings__summary">{children}</span>
    </button>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
