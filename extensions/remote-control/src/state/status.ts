/**
 * What Remote Control is doing, as one value.
 *
 * The main process has always broadcast enough to answer this — `remote:status`
 * carries enabled, port, lanUrl, publicUrl and ngrokError. The view simply never
 * rendered it as a state, so it could not say whether it was on, at what
 * address, or why it had failed. This is the missing translation, kept pure so
 * every transition is testable without a server.
 */

type FailureReason =
  | 'port-in-use'
  | 'password-required'
  | 'credential-rejected'
  | 'tunnel-dropped'
  | 'tunnel-unreachable'

interface RemoteFailure {
  reason: FailureReason
  /** What happened, in the reader's language. */
  message: string
  /** The action that resolves it, if there is one. */
  resolution: string | null
}

export type RemoteStatus =
  | { kind: 'off' }
  | { kind: 'starting'; port: number }
  /**
   * Listening. `reach` separates the two cases the old view showed
   * identically: a public address anyone can open, and a local-only one that
   * works on this network because no credential was supplied for the tunnel.
   */
  | {
      kind: 'on'
      port: number
      localUrl: string
      publicUrl: string | null
      reach: 'public' | 'local-only'
    }
  | { kind: 'failed'; port: number; failure: RemoteFailure }

/** The shape `remote:status` arrives in. Every field is optional by history. */
interface StatusBroadcast {
  enabled?: boolean
  port?: number
  lanUrl?: string | null
  publicUrl?: string | null
  ngrokInstalled?: boolean
  ngrokError?: string | null
  error?: string
  message?: string
}

export const OFF: RemoteStatus = { kind: 'off' }

const DEFAULT_PORT = 7681

/**
 * A broadcast, folded onto the current status.
 *
 * Takes the previous status as a parameter rather than reading it from
 * anywhere, so a sequence of broadcasts is replayable in a test exactly as it
 * arrives in the app.
 */
export function reduceStatus(previous: RemoteStatus, message: StatusBroadcast): RemoteStatus {
  const port = message.port ?? portOf(previous) ?? DEFAULT_PORT

  // A hard error arrives on its own, without the enabled/url fields.
  const hardError = hardErrorStatus(message, port)
  if (hardError) return hardError

  if (message.enabled === false) return OFF

  if (message.enabled !== true) return previous

  if (stillDropped(previous, message)) return previous

  return enabledStatus(previous, message, port)
}

/**
 * A dropped tunnel is followed at once by a broadcast of the local address
 * alone. That broadcast says nothing new about the tunnel, so the drop stands
 * until one brings a public address or a new tunnel error.
 */
function stillDropped(previous: RemoteStatus, message: StatusBroadcast): boolean {
  if (previous.kind !== 'failed' || previous.failure.reason !== 'tunnel-dropped') return false
  return !message.publicUrl && !message.ngrokError
}

function hardErrorStatus(message: StatusBroadcast, port: number): RemoteStatus | null {
  if (message.error === 'PORT_IN_USE') {
    return failed(port, {
      reason: 'port-in-use',
      message: `Port ${port} is already in use.`,
      resolution:
        'Another program is listening on it. Pick a different port, or quit that program.',
    })
  }
  if (message.error === 'PASSWORD_REQUIRED') {
    return failed(port, {
      reason: 'password-required',
      message: message.message ?? 'Remote Control needs a password before it can start.',
      resolution: 'Open Settings below and set a password, or generate one.',
    })
  }
  return null
}

/** The status of an enabled server, from the addresses and tunnel error it reports. */
function enabledStatus(
  previous: RemoteStatus,
  message: StatusBroadcast,
  port: number
): RemoteStatus {
  const localUrl = message.lanUrl ?? localUrlOf(previous) ?? ''
  if (message.ngrokError) return tunnelErrorStatus(message.ngrokError, port, localUrl)
  return listeningStatus(port, localUrl, message.publicUrl ?? null)
}

function listeningStatus(port: number, localUrl: string, publicUrl: string | null): RemoteStatus {
  // Enabled, no address yet: still coming up.
  if (!localUrl && !publicUrl) return { kind: 'starting', port }
  const reach = publicUrl ? 'public' : 'local-only'
  return { kind: 'on', port, localUrl, publicUrl, reach }
}

function tunnelErrorStatus(ngrokError: string, port: number, localUrl: string): RemoteStatus {
  // Missing credential is not a failure: the local address still works, and
  // saying "failed" would be wrong about what the user can currently do.
  if (isMissingCredential(ngrokError)) {
    return { kind: 'on', port, localUrl, publicUrl: null, reach: 'local-only' }
  }
  return failed(port, {
    reason: 'tunnel-unreachable',
    message: 'The public address could not be created.',
    resolution: ngrokError,
  })
}

function failed(port: number, failure: RemoteFailure): RemoteStatus {
  return { kind: 'failed', port, failure }
}

/** The tunnel dropped while devices were connected. */
export function tunnelDropped(previous: RemoteStatus): RemoteStatus {
  if (previous.kind !== 'on') return previous
  return {
    kind: 'failed',
    port: previous.port,
    failure: {
      reason: 'tunnel-dropped',
      message: 'The public address stopped working.',
      resolution: 'Anyone connected through it has been disconnected. Reconnect to get a new one.',
    },
  }
}

function portOf(status: RemoteStatus): number | null {
  return status.kind === 'off' ? null : status.port
}

function localUrlOf(status: RemoteStatus): string | null {
  return status.kind === 'on' ? status.localUrl : null
}

function isMissingCredential(error: string): boolean {
  return /auth token|authtoken|requires an auth/i.test(error)
}
