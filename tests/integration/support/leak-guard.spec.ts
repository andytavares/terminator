import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { createLeakGuard } from '../../support/leak-guard'

describe('the leak guard tests/setup.ts runs after every test', () => {
  describe('handles', handleTests)
})

function handleTests() {
  it('names a server that is still listening, and passes once it is closed', async () => {
    const guard = createLeakGuard()
    guard.begin()
    const server = net.createServer().listen(0, '127.0.0.1')
    await once(server, 'listening')
    await expect(guard.check()).rejects.toThrow(/left a TCPSERVERWRAP running/)
    server.close()
    await once(server, 'close')
    await expect(guard.check()).resolves.toBeUndefined()
  })
}
