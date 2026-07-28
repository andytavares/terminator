import { describe, it, expect, afterEach } from 'vitest'
import {
  createControlServer,
  type ControlServer,
  type HookDecision,
} from '../../../../../src/main/supervision/agent-runtime/control-server.js'

// The hook posts a tool call and the reply is withheld until the operator
// decides. Exercised against a real listener rather than a mocked one: the
// blocking is the behaviour, and a mock that resolves immediately would prove
// the opposite of what matters.

let server: ControlServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

async function post(
  target: ControlServer,
  body: unknown,
  token = target.token
): Promise<{ status: number; decision: HookDecision }> {
  const response = await fetch(target.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, decision: (await response.json()) as HookDecision }
}

const ask = { sessionId: 's1', toolName: 'Bash', input: { command: 'rm -rf /' } }

describe('createControlServer', () => {
  it('listens on loopback only', async () => {
    server = await createControlServer()
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/pretooluse$/)
  })

  it('mints a token long enough not to be guessed', async () => {
    server = await createControlServer()
    expect(server.token).toHaveLength(64)
  })

  it('mints a different token each run', async () => {
    server = await createControlServer()
    const second = await createControlServer()
    expect(second.token).not.toBe(server.token)
    await second.close()
  })

  it('delivers the tool call to the session that owns it', async () => {
    server = await createControlServer()
    let seen: unknown = null
    server.register('s1', {
      decide: async (request) => {
        seen = request
        return { permissionDecision: 'allow' }
      },
    })
    await post(server, ask)
    expect(seen).toEqual(ask)
  })

  it('returns what the operator decided', async () => {
    server = await createControlServer()
    server.register('s1', {
      decide: async () => ({
        permissionDecision: 'deny',
        reason: 'not on production',
      }),
    })
    const { decision } = await post(server, ask)
    expect(decision).toEqual({ permissionDecision: 'deny', reason: 'not on production' })
  })

  it('holds the connection open until the operator answers', async () => {
    server = await createControlServer()
    let answer: ((decision: HookDecision) => void) | null = null
    server.register('s1', {
      decide: () => new Promise<HookDecision>((resolve) => (answer = resolve)),
    })

    let settled = false
    const pending = post(server, ask).then((result) => {
      settled = true
      return result
    })
    // Severed at teardown if the test fails before answering; an unhandled
    // rejection there would be reported as a suite error.
    pending.catch(() => {})

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)
    ;(answer as unknown as (decision: HookDecision) => void)({ permissionDecision: 'allow' })
    expect((await pending).decision.permissionDecision).toBe('allow')
  })

  it('refuses a caller without the token, so nothing else on the machine can approve', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    const { status, decision } = await post(server, ask, 'wrong')
    expect(status).toBe(401)
    expect(decision.permissionDecision).toBe('ask')
  })

  it('falls back to the terminal prompt for a session it does not know', async () => {
    server = await createControlServer()
    const { decision } = await post(server, ask)
    // Not allow — nothing is approved behind the operator's back — and not
    // deny, which would refuse work because the console restarted.
    expect(decision.permissionDecision).toBe('ask')
  })

  it('falls back to the terminal prompt once a session is unregistered', async () => {
    server = await createControlServer()
    const forget = server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    forget()
    expect((await post(server, ask)).decision.permissionDecision).toBe('ask')
  })

  it('falls back to the terminal prompt when the decider throws', async () => {
    server = await createControlServer()
    server.register('s1', {
      decide: async () => {
        throw new Error('registry is gone')
      },
    })
    expect((await post(server, ask)).decision.permissionDecision).toBe('ask')
  })

  it('rejects a body that is not a hook request', async () => {
    server = await createControlServer()
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}` },
      body: 'not json',
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as HookDecision).permissionDecision).toBe('ask')
  })

  it('rejects a request naming no session', async () => {
    server = await createControlServer()
    const { status } = await post(server, { toolName: 'Bash' })
    expect(status).toBe(400)
  })

  it('rejects a request naming no tool', async () => {
    server = await createControlServer()
    const { status } = await post(server, { sessionId: 's1' })
    expect(status).toBe(400)
  })

  it('serves nothing but the hook endpoint', async () => {
    server = await createControlServer()
    const response = await fetch(server.url.replace('/pretooluse', '/'), {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}` },
      body: '{}',
    })
    expect(response.status).toBe(404)
  })

  it('serves nothing to a GET', async () => {
    server = await createControlServer()
    const response = await fetch(server.url, {
      headers: { authorization: `Bearer ${server.token}` },
    })
    expect(response.status).toBe(404)
  })

  it('keeps two sessions apart', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    server.register('s2', { decide: async () => ({ permissionDecision: 'deny', reason: 'no' }) })
    const first = await post(server, ask)
    const second = await post(server, { ...ask, sessionId: 's2' })
    expect(first.decision.permissionDecision).toBe('allow')
    expect(second.decision.permissionDecision).toBe('deny')
  })

  it('stops answering once closed', async () => {
    const closing = await createControlServer()
    const { url, token } = closing
    await closing.close()
    await expect(
      fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })
    ).rejects.toThrow()
  })
})

describe('the lifecycle endpoint', () => {
  async function postEvent(target: ControlServer, body: unknown): Promise<{ status: number }> {
    const response = await fetch(target.eventUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status }
  }

  it('shares the listener and the token with the tool-call endpoint', async () => {
    server = await createControlServer()
    expect(server.eventUrl).toBe(server.url.replace('/pretooluse', '/event'))
  })

  it('reports the end of a turn, which is what tells a finished session from a stuck one', async () => {
    server = await createControlServer()
    const seen: string[] = []
    server.register('s1', {
      decide: async () => ({ permissionDecision: 'allow' }),
      onEvent: (kind) => seen.push(kind),
    })
    await postEvent(server, { sessionId: 's1', kind: 'stop' })
    expect(seen).toEqual(['stop'])
  })

  it('reports the end of a session', async () => {
    server = await createControlServer()
    const seen: string[] = []
    server.register('s1', {
      decide: async () => ({ permissionDecision: 'allow' }),
      onEvent: (kind) => seen.push(kind),
    })
    await postEvent(server, { sessionId: 's1', kind: 'session_end' })
    expect(seen).toEqual(['session_end'])
  })

  it('answers immediately rather than holding the agent up', async () => {
    server = await createControlServer()
    server.register('s1', {
      decide: async () => ({ permissionDecision: 'allow' }),
      // A listener that throws must not become a hung hook.
      onEvent: () => {
        throw new Error('the surface blew up')
      },
    })
    expect((await postEvent(server, { sessionId: 's1', kind: 'stop' })).status).toBe(200)
  })

  it('accepts an event for a session that wants only tool decisions', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    expect((await postEvent(server, { sessionId: 's1', kind: 'stop' })).status).toBe(200)
  })

  it('accepts an event for a session it no longer knows', async () => {
    server = await createControlServer()
    expect((await postEvent(server, { sessionId: 'gone', kind: 'stop' })).status).toBe(200)
  })

  it('rejects a kind it does not recognise, rather than inventing a state change', async () => {
    server = await createControlServer()
    expect((await postEvent(server, { sessionId: 's1', kind: 'exploded' })).status).toBe(400)
  })

  it('rejects an event naming no session', async () => {
    server = await createControlServer()
    expect((await postEvent(server, { kind: 'stop' })).status).toBe(400)
  })

  it('refuses an event without the token', async () => {
    server = await createControlServer()
    const response = await fetch(server.eventUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      body: '{}',
    })
    expect(response.status).toBe(401)
  })
})
