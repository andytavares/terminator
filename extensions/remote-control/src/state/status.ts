/**
 * What Remote Control is doing, as one value.
 *
 * The main process has always broadcast enough to answer this — `remote:status`
 * carries enabled, port, lanUrl, publicUrl and ngrokError. The view simply never
 * rendered it as a state, so it could not say whether it was on, at what
 * address, or why it had failed. This is the missing translation, kept pure so
 * every transition is testable without a server.
 */

export type FailureReason =
  | 'port-in-use'
  | 'credential-rejected'
  | 'tunnel-dropped'
  | 'tunnel-unreachable'

export interface RemoteFailure {
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
export interface StatusBroadcast {
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
  if (message.error === 'PORT_IN_USE') {
    return {
      kind: 'failed',
      port,
      failure: {
        reason: 'port-in-use',
        message: `Port ${port} is already in use.`,
        resolution:
          'Another program is listening on it. Pick a different port, or quit that program.',
      },
    }
  }

  if (message.enabled === false) return OFF

  if (message.enabled !== true) return previous

  const localUrl = message.lanUrl ?? localUrlOf(previous) ?? ''
  const publicUrl = message.publicUrl ?? null

  if (message.ngrokError) {
    // Missing credential is not a failure: the local address still works, and
    // saying "failed" would be wrong about what the user can currently do.
    if (isMissingCredential(message.ngrokError)) {
      return { kind: 'on', port, localUrl, publicUrl: null, reach: 'local-only' }
    }
    return {
      kind: 'failed',
      port,
      failure: {
        reason: 'tunnel-unreachable',
        message: 'The public address could not be created.',
        resolution: message.ngrokError,
      },
    }
  }

  // Enabled, no address yet: still coming up.
  if (!localUrl && !publicUrl) return { kind: 'starting', port }

  return {
    kind: 'on',
    port,
    localUrl,
    publicUrl,
    reach: publicUrl ? 'public' : 'local-only',
  }
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
      resolution:
        'Anyone connected through it has been disconnected. Turn it off and on to get a new one.',
    },
  }
}

/** True when this status can serve a browser at all. */
export function isReachable(status: RemoteStatus): boolean {
  return status.kind === 'on'
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
