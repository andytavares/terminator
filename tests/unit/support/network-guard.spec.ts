import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { assertLoopback } from '../../support/network-guard'

describe('the network guard tests/setup.ts installs', () => {
  it('refuses a connection to another machine, naming the host', () => {
    expect(() => net.connect({ host: 'example.com', port: 80 })).toThrow(
      'A spec may only connect to localhost: example.com'
    )
  })

  it('refuses the (port, host) form and an address that is not loopback', () => {
    expect(() => net.connect(443, '93.184.216.34')).toThrow(
      'A spec may only connect to localhost: 93.184.216.34'
    )
  })

  it('lets a spec connect to a server of its own on localhost', async () => {
    const server = net.createServer((socket) => socket.end())
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as net.AddressInfo
    const socket = net.connect(port, '127.0.0.1')
    await once(socket, 'close')
    server.close()
    await once(server, 'close')
  })

  it.each([['localhost'], ['127.0.0.1'], ['::1']])('accepts %s', (host) => {
    expect(() => assertLoopback([{ host, port: 1 }])).not.toThrow()
  })

  it('accepts a Unix socket path, which never leaves the machine', () => {
    expect(() => assertLoopback(['/tmp/agent.sock'])).not.toThrow()
    expect(() => assertLoopback([{ path: '/tmp/agent.sock' }])).not.toThrow()
  })
})
