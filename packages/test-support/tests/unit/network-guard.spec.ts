import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { assertLoopback, assertNoTcp } from '../../src/network-guard'

describe('the network guard packages/test-support/setup.ts installs', () => {
  it('refuses a connection to another machine, naming the host', () => {
    expect(() => assertLoopback([{ host: 'example.com', port: 80 }])).toThrow(
      'A spec may only connect to localhost: example.com'
    )
  })

  it('refuses the (port, host) form and an address that is not loopback', () => {
    expect(() => assertLoopback([443, '93.184.216.34'])).toThrow(
      'A spec may only connect to localhost: 93.184.216.34'
    )
  })

  it.each([['localhost'], ['127.0.0.1'], ['::1']])('accepts %s', (host) => {
    expect(() => assertLoopback([{ host, port: 1 }])).not.toThrow()
  })

  it('accepts a Unix socket path, which never leaves the machine', () => {
    expect(() => assertLoopback(['/tmp/agent.sock'])).not.toThrow()
    expect(() => assertLoopback([{ path: '/tmp/agent.sock' }])).not.toThrow()
  })
})

describe('the network guard in a unit test', () => {
  it('refuses a TCP connection to this machine too', () => {
    expect(() => net.connect({ host: '127.0.0.1', port: 1 })).toThrow(
      'A unit test may open no TCP socket (T-BOUNDARY): 127.0.0.1'
    )
  })

  it('accepts a Unix socket path, which is a pipe and not the network', () => {
    expect(() => assertNoTcp([{ path: '/tmp/agent.sock' }])).not.toThrow()
  })
})
