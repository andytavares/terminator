import { describe, it, expect, vi, afterEach } from 'vitest'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { RpcEndpoint, type MessageLink } from '../../../../../src/main/extensions/host/rpc-endpoint'
import { CwdOutOfScopeError } from '../../../../../src/main/shell/shell-executor'

const ports: MessagePort[] = []

function link(port: MessagePort): MessageLink {
  ports.push(port)
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => port.on('message', receive),
  }
}

/** Two endpoints joined by a real MessageChannel, so every value is structured-cloned. */
function pair() {
  const { port1, port2 } = new MessageChannel()
  return { main: new RpcEndpoint(link(port1)), host: new RpcEndpoint(link(port2)) }
}

afterEach(() => {
  for (const port of ports.splice(0)) port.close()
})

describe('RpcEndpoint', () => {
  it('answers a request with what the other side returned, awaited', async () => {
    const { main, host } = pair()
    main.handle('workspace.list', async (prefix: string) => [`${prefix}-1`])

    await expect(host.request('workspace.list', 'ws')).resolves.toEqual(['ws-1'])
  })

  it('rejects with the error the other side threw, keeping its name', async () => {
    const { main, host } = pair()
    main.handle('pty.spawnSession', () => {
      const error = new Error('no such directory')
      error.name = 'MissingCwdError'
      throw error
    })

    const failure = await host.request('pty.spawnSession').catch((error: Error) => error)
    expect(failure).toMatchObject({ name: 'MissingCwdError', message: 'no such directory' })
  })

  it('carries a refused cwd across as its name and message, and nothing else', async () => {
    const { main, host } = pair()
    main.handle('shell.exec', () => {
      throw new CwdOutOfScopeError('/elsewhere')
    })

    const failure = await host.request('shell.exec').catch((error: Error) => error)
    expect(failure).toMatchObject({ name: 'CwdOutOfScopeError', message: expect.any(String) })
    expect((failure as Error).message).toContain('/elsewhere')
    expect(failure).not.toHaveProperty('code')
  })
})

describe('RpcEndpoint — unhandled methods and events', () => {
  it('rejects a request for a method nobody handles', async () => {
    const { host } = pair()
    await expect(host.request('nothing')).rejects.toThrow('No handler for "nothing"')
  })

  it('delivers events in the order they were sent, without an answer', async () => {
    const { main, host } = pair()
    const received: string[] = []
    const done = new Promise<void>((resolve) =>
      main.handle('pty.write', (data: string) => {
        received.push(data)
        if (received.length === 3) resolve()
      })
    )
    host.notify('pty.write', 'a')
    host.notify('pty.write', 'b')
    host.notify('pty.write', 'c')
    await done
    expect(received).toEqual(['a', 'b', 'c'])
  })
})

describe('RpcEndpoint — failures', () => {
  it('reports an event handler that throws instead of losing it', async () => {
    const { port1, port2 } = new MessageChannel()
    const onEventError = vi.fn()
    const main = new RpcEndpoint(link(port1), onEventError)
    const host = new RpcEndpoint(link(port2))
    main.handle('callback', () => {
      throw new Error('listener broke')
    })
    main.handle('api', async () => {
      throw new Error('member rejected')
    })
    host.notify('callback')
    host.notify('api')
    await vi.waitFor(() => expect(onEventError).toHaveBeenCalledTimes(2))
    expect(onEventError).toHaveBeenCalledWith('callback', expect.any(Error))
    expect(onEventError).toHaveBeenCalledWith('api', expect.any(Error))
  })

  it('fails every waiting request when the other side is gone', async () => {
    const { port1, port2 } = new MessageChannel()
    ports.push(port2)
    const silent = new RpcEndpoint(link(port1))
    const waiting = silent.request('never.answered')
    silent.failPending('extension host exited')
    await expect(waiting).rejects.toThrow('extension host exited')
  })
})
