import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'

describe('the network guard packages/test-support/setup.ts installs — localhost', () => {
  it('lets a spec connect to a server of its own on localhost', async () => {
    let connections = 0
    const server = net.createServer((socket) => {
      connections += 1
      socket.end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as net.AddressInfo
    const socket = net.connect(port, '127.0.0.1')
    await once(socket, 'close')
    server.close()
    await once(server, 'close')
    expect(connections).toBe(1)
  })
})
