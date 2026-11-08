import { describe, it, expect } from 'vitest'
import { OFF, reduceStatus, tunnelDropped, type RemoteStatus } from '../../src/state/status'

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

describe('reduceStatus', reduceStatusTests)

describe('tunnelDropped', () => {
  describe('the drop', tunnelDropTests)
  describe('what follows it', tunnelDropFollowUpTests)
})

function tunnelDropTests() {
  it('moves a running server to a named failure', () => {
    expect(tunnelDropped(ON)).toMatchObject({
      kind: 'failed',
      failure: { reason: 'tunnel-dropped', resolution: expect.stringMatching(/\S/) },
    })
  })

  it('leaves a status that was never on alone', () => {
    expect(tunnelDropped(OFF)).toBe(OFF)
  })
}

function tunnelDropFollowUpTests() {
  it('outlasts the listening broadcast that follows the drop, which has no public address', () => {
    // The extension broadcasts remote:tunnel-disconnected, then the local address alone.
    const dropped = tunnelDropped(ON)
    const next = reduceStatus(dropped, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: null,
      ngrokInstalled: true,
    })
    expect(next).toBe(dropped)
  })

  it('gives way once the tunnel is back', () => {
    const next = reduceStatus(tunnelDropped(ON), {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      publicUrl: 'https://brave-otter-7.ngrok.app',
    })
    expect(next).toMatchObject({ kind: 'on', publicUrl: 'https://brave-otter-7.ngrok.app' })
  })
}

function reduceStatusTests() {
  describe('coming up', reduceStatusStartupTests)
  describe('reach', reduceStatusReachTests)
  describe('tunnel failures', reduceStatusTunnelFailureTests)
  reduceStatusNoPasswordTests()
  reduceStatusPortInUseTests()
  describe('partial broadcasts', reduceStatusPartialBroadcastTests)
  reduceStatusReplayTests()
}

function reduceStatusStartupTests() {
  it('goes off when the server reports disabled', () => {
    expect(reduceStatus(ON, { enabled: false }).kind).toBe('off')
  })

  it('is starting once enabled but before any address exists', () => {
    const next = reduceStatus(OFF, { enabled: true, port: 7681 })
    expect(next).toEqual({ kind: 'starting', port: 7681 })
  })
}

function reduceStatusReachTests() {
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
}

function reduceStatusTunnelFailureTests() {
  it('treats any other tunnel error as a failure with a stated resolution', () => {
    const next = reduceStatus(OFF, {
      enabled: true,
      port: 7681,
      lanUrl: 'http://192.168.1.4:7681',
      ngrokError: 'upstream refused the connection',
    })
    expect(next).toMatchObject({
      kind: 'failed',
      failure: { reason: 'tunnel-unreachable', resolution: 'upstream refused the connection' },
    })
  })
}

function reduceStatusNoPasswordTests() {
  describe('no password set', () => {
    it('fails with a way forward instead of going quietly off', () => {
      const status = reduceStatus(OFF, { enabled: false, error: 'PASSWORD_REQUIRED' })
      expect(status).toMatchObject({ kind: 'failed', failure: { reason: 'password-required' } })
    })

    it('shows the explanation the main process sent', () => {
      const status = reduceStatus(OFF, {
        enabled: false,
        error: 'PASSWORD_REQUIRED',
        message: 'The saved password used an old format.',
      })
      expect(status).toMatchObject({
        failure: { message: 'The saved password used an old format.' },
      })
    })
  })
}

function reduceStatusPortInUseTests() {
  describe('port already in use', () => {
    it('fails, naming the port and offering a way forward', () => {
      const next = reduceStatus(OFF, { error: 'PORT_IN_USE', port: 7681 })
      expect(next).toMatchObject({
        kind: 'failed',
        failure: {
          reason: 'port-in-use',
          message: expect.stringContaining('7681'),
          resolution: expect.stringMatching(/\S/),
        },
      })
    })

    it('remembers the port from the previous status when the error omits it', () => {
      expect(reduceStatus(ON, { error: 'PORT_IN_USE' })).toMatchObject({
        kind: 'failed',
        failure: { message: expect.stringContaining('7681') },
      })
    })
  })
}

function reduceStatusPartialBroadcastTests() {
  it('ignores a broadcast that says nothing about enablement', () => {
    expect(reduceStatus(ON, {})).toBe(ON)
  })

  it('carries the port forward when a later broadcast omits it', () => {
    const next = reduceStatus(ON, { enabled: true, lanUrl: 'http://192.168.1.4:7681' })
    expect(next).toMatchObject({ port: 7681 })
  })
}

function reduceStatusReplayTests() {
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
}
