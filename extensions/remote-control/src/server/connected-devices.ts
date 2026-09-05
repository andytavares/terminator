/**
 * Who is connected right now.
 *
 * The server has always known — it owns the sockets — but nothing surfaced it,
 * so the view could not answer the question people open Remote Control to ask.
 * A stale list would be worse than none here: this is a security surface, and
 * "who currently has shell access" has to be current.
 */

export interface ConnectedDevice {
  /** Stable for the life of the connection; the handle `disconnect` takes. */
  id: string
  /** What the person recognises, never the raw user agent. */
  label: string
  /** Which terminal it is watching. */
  viewing: string
  connectedAt: number
}

/**
 * A recognisable name for a browser.
 *
 * Deliberately coarse. "iPhone" is what someone holding the phone will look
 * for; the full user-agent string is noise and, on a screen that also shows an
 * access credential, noise worth not printing.
 */
export function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device'
  const ua = userAgent.toLowerCase()

  if (ua.includes('ipad')) return 'iPad'
  if (ua.includes('iphone')) return 'iPhone'
  // Android tablets omit "mobile"; phones include it.
  if (ua.includes('android')) return ua.includes('mobile') ? 'Android phone' : 'Android tablet'
  if (ua.includes('macintosh') || ua.includes('mac os')) return browserOn(ua, 'Mac')
  if (ua.includes('windows')) return browserOn(ua, 'Windows')
  if (ua.includes('linux')) return browserOn(ua, 'Linux')
  return 'Unknown device'
}

function browserOn(ua: string, platform: string): string {
  // Order matters: Edge and Chrome both claim Safari, Chrome claims Safari.
  if (ua.includes('edg/')) return `Edge on ${platform}`
  if (ua.includes('firefox')) return `Firefox on ${platform}`
  if (ua.includes('chrome')) return `Chrome on ${platform}`
  if (ua.includes('safari')) return `Safari on ${platform}`
  return platform
}

type Listener = (devices: ConnectedDevice[]) => void

/**
 * The live set, with a change signal.
 *
 * `now` is injected so the list is deterministic in a test rather than a
 * function of when it happened to run.
 */
export class ConnectedDeviceRegistry {
  private devices = new Map<string, ConnectedDevice>()
  private closers = new Map<string, () => void>()
  private listeners = new Set<Listener>()
  private now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /**
   * `close` is how "Disconnect" in the view actually reaches the socket. Held
   * beside the device rather than in the published shape, so the list crossing
   * the bridge stays plain data.
   */
  add(
    id: string,
    userAgent: string | undefined,
    viewing: string,
    close?: () => void
  ): ConnectedDevice {
    const device: ConnectedDevice = {
      id,
      label: deviceLabel(userAgent),
      viewing,
      connectedAt: this.now(),
    }
    this.devices.set(id, device)
    if (close) this.closers.set(id, close)
    this.emit()
    return device
  }

  /**
   * Close one device's connection.
   *
   * The socket closing is what removes it from the list, so this does not
   * delete anything itself — one source of truth, and a disconnect that fails
   * leaves the row visible rather than lying about it.
   */
  disconnect(id: string): boolean {
    const close = this.closers.get(id)
    if (!close) return false
    close()
    return true
  }

  remove(id: string): void {
    this.closers.delete(id)
    if (this.devices.delete(id)) this.emit()
  }

  list(): ConnectedDevice[] {
    // Oldest first, so a list that grows does not reorder what is already read.
    return [...this.devices.values()].sort((a, b) => a.connectedAt - b.connectedAt)
  }

  count(): number {
    return this.devices.size
  }

  /** Returns the unsubscribe, so a caller cannot leak a listener. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snapshot = this.list()
    for (const listener of this.listeners) listener(snapshot)
  }
}
