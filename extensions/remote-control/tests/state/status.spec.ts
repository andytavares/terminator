import { describe, it, expect } from 'vitest'
import {
  OFF,
  isReachable,
  reduceStatus,
  tunnelDropped,
  type RemoteStatus,
} from '../../src/state/status'

// The old view rendered a settings form and could not say whether Remote Control
// was on, at what address, or why it had failed — even though the main process
// had been broadcasting all of it. This is the translation, and it is pure so a
// sequence of broadcasts replays exactly as it arrives in the app.

const ON: RemoteStatus = {
  kind: 'on',
  port: 7681,
  localUrl: 'http://192.168.1.4:7681',
  publicUrl: 'https://tender-lynx-42.ngrok.app',
  reach: 'public',
}

describe('reduceStatus', () => {
  it('starts off', () => {
    expect(OFF.kind).toBe('off')
  })

  it('goes off when the server reports disabled', () => {
    expect(reduceStatus(ON, { enabled: false }).kind).toBe('off')
  })

  it('is starting once enabled but before any address exists', () => {
    const next = reduceStatus(OFF, { enabled: true, port: 7681 })
    expect(next).toEqual({ kind: 'starting', port: 7681 })
  })

  it('is on once a local address arrives', () => {
    const next = reduceStatus(OFF, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: null,
    })
    expect(next.kind).toBe('on')
  })

  it('reports public reach once a tunnel address arrives', () => {
    const next = reduceStatus(OFF, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: 'https://tender-lynx-42.ngrok.app',
    })
    expect(next).toMatchObject({ kind: 'on', reach: 'public' })
  })

  // The distinction the old screen could not draw: running and reachable on this
  // network, but with no public address because no credential was supplied.
  it('reports local-only when the credential is missing, not failure', () => {
    const next = reduceStatus(OFF, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: null,
      ngrokError: 'ngrok requires an auth token — add yours in Settings',
    })
    expect(next).toMatchObject({ kind: 'on', reach: 'local-only', publicUrl: null })
  })

  it('treats any other tunnel error as a failure with a stated resolution', () => {
    const next = reduceStatus(OFF, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      ngrokError: 'upstream refused the connection',
    })
    expect(next.kind).toBe('failed')
    if (next.kind !== 'failed') throw new Error('unreachable')
    expect(next.failure.reason).toBe('tunnel-unreachable')
    expect(next.failure.resolution).toBe('upstream refused the connection')
  })

  describe('port already in use', () => {
    it('fails, naming the port', () => {
      const next = reduceStatus(OFF, { error: 'PORT_IN_USE', port: 7681 })
      expect(next.kind).toBe('failed')
      if (next.kind !== 'failed') throw new Error('unreachable')
      expect(next.failure.reason).toBe('port-in-use')
      expect(next.failure.message).toContain('7681')
    })

    it('offers a way forward rather than only the error', () => {
      const next = reduceStatus(OFF, { error: 'PORT_IN_USE', port: 7681 })
      if (next.kind !== 'failed') throw new Error('unreachable')
      expect(next.failure.resolution).toBeTruthy()
    })

    it('remembers the port from the previous status when the error omits it', () => {
      const next = reduceStatus(ON, { error: 'PORT_IN_USE' })
      if (next.kind !== 'failed') throw new Error('unreachable')
      expect(next.failure.message).toContain('7681')
    })
  })

  it('ignores a broadcast that says nothing about enablement', () => {
    expect(reduceStatus(ON, {})).toBe(ON)
  })

  it('carries the port forward when a later broadcast omits it', () => {
    const next = reduceStatus(ON, { enabled: true, lanUrl: 'http://192.168.1.4:7681' })
    expect(next).toMatchObject({ port: 7681 })
  })

  it('replays a whole start sequence', () => {
    let status = OFF
    status = reduceStatus(status, { enabled: true, port: 7681 })
    expect(status.kind).toBe('starting')
    status = reduceStatus(status, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: null,
    })
    expect(status).toMatchObject({ kind: 'on', reach: 'local-only' })
    status = reduceStatus(status, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: 'https://tender-lynx-42.ngrok.app',
    })
    expect(status).toMatchObject({ kind: 'on', reach: 'public' })
    status = reduceStatus(status, { enabled: false })
    expect(status.kind).toBe('off')
  })
})

describe('tunnelDropped', () => {
  it('moves a running server to a named failure', () => {
    const next = tunnelDropped(ON)
    expect(next.kind).toBe('failed')
    if (next.kind !== 'failed') throw new Error('unreachable')
    expect(next.failure.reason).toBe('tunnel-dropped')
    expect(next.failure.resolution).toBeTruthy()
  })

  it('leaves a status that was never on alone', () => {
    expect(tunnelDropped(OFF)).toBe(OFF)
  })
})

describe('isReachable', () => {
  it.each([
    [OFF, false],
    [{ kind: 'starting', port: 7681 } as RemoteStatus, false],
    [ON, true],
  ])('reports %o as %s', (status, expected) => {
    expect(isReachable(status as RemoteStatus)).toBe(expected)
  })
})
