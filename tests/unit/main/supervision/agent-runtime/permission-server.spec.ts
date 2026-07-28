import { describe, it, expect, afterEach } from 'vitest'
import {
  createPermissionServer,
  type PermissionServer,
  type HookDecision,
} from '../../../../../src/main/supervision/agent-runtime/permission-server.js'

// The hook posts a tool call and the reply is withheld until the operator
// decides. Exercised against a real listener rather than a mocked one: the
// blocking is the behaviour, and a mock that resolves immediately would prove
// the opposite of what matters.

let server: PermissionServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

async function post(
  target: PermissionServer,
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

describe('createPermissionServer', () => {
  it('listens on loopback only', async () => {
    server = await createPermissionServer()
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/pretooluse$/)
  })

  it('mints a token long enough not to be guessed', async () => {
    server = await createPermissionServer()
    expect(server.token).toHaveLength(64)
  })

  it('mints a different token each run', async () => {
    server = await createPermissionServer()
    const second = await createPermissionServer()
    expect(second.token).not.toBe(server.token)
    await second.close()
  })

  it('delivers the tool call to the session that owns it', async () => {
    server = await createPermissionServer()
    let seen: unknown = null
    server.register('s1', async (request) => {
      seen = request
      return { permissionDecision: 'allow' }
    })
    await post(server, ask)
    expect(seen).toEqual(ask)
  })

  it('returns what the operator decided', async () => {
    server = await createPermissionServer()
    server.register('s1', async () => ({
      permissionDecision: 'deny',
      reason: 'not on production',
    }))
    const { decision } = await post(server, ask)
    expect(decision).toEqual({ permissionDecision: 'deny', reason: 'not on production' })
  })

  it('holds the connection open until the operator answers', async () => {
    server = await createPermissionServer()
    let answer: ((decision: HookDecision) => void) | null = null
    server.register('s1', () => new Promise<HookDecision>((resolve) => (answer = resolve)))

    let settled = false
    const pending = post(server, ask).then((result) => {
      settled = true
      return result
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)
    ;(answer as unknown as (decision: HookDecision) => void)({ permissionDecision: 'allow' })
    expect((await pending).decision.permissionDecision).toBe('allow')
  })

  it('refuses a caller without the token, so nothing else on the machine can approve', async () => {
    server = await createPermissionServer()
    server.register('s1', async () => ({ permissionDecision: 'allow' }))
    const { status, decision } = await post(server, ask, 'wrong')
    expect(status).toBe(401)
    expect(decision.permissionDecision).toBe('ask')
  })

  it('falls back to the terminal prompt for a session it does not know', async () => {
    server = await createPermissionServer()
    const { decision } = await post(server, ask)
    // Not allow — nothing is approved behind the operator's back — and not
    // deny, which would refuse work because the console restarted.
    expect(decision.permissionDecision).toBe('ask')
  })

  it('falls back to the terminal prompt once a session is unregistered', async () => {
    server = await createPermissionServer()
    const forget = server.register('s1', async () => ({ permissionDecision: 'allow' }))
    forget()
    expect((await post(server, ask)).decision.permissionDecision).toBe('ask')
  })

  it('falls back to the terminal prompt when the decider throws', async () => {
    server = await createPermissionServer()
    server.register('s1', async () => {
      throw new Error('registry is gone')
    })
    expect((await post(server, ask)).decision.permissionDecision).toBe('ask')
  })

  it('rejects a body that is not a hook request', async () => {
    server = await createPermissionServer()
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}` },
      body: 'not json',
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as HookDecision).permissionDecision).toBe('ask')
  })

  it('rejects a request naming no session', async () => {
    server = await createPermissionServer()
    const { status } = await post(server, { toolName: 'Bash' })
    expect(status).toBe(400)
  })

  it('rejects a request naming no tool', async () => {
    server = await createPermissionServer()
    const { status } = await post(server, { sessionId: 's1' })
    expect(status).toBe(400)
  })

  it('serves nothing but the hook endpoint', async () => {
    server = await createPermissionServer()
    const response = await fetch(server.url.replace('/pretooluse', '/'), {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}` },
      body: '{}',
    })
    expect(response.status).toBe(404)
  })

  it('serves nothing to a GET', async () => {
    server = await createPermissionServer()
    const response = await fetch(server.url, {
      headers: { authorization: `Bearer ${server.token}` },
    })
    expect(response.status).toBe(404)
  })

  it('keeps two sessions apart', async () => {
    server = await createPermissionServer()
    server.register('s1', async () => ({ permissionDecision: 'allow' }))
    server.register('s2', async () => ({ permissionDecision: 'deny', reason: 'no' }))
    const first = await post(server, ask)
    const second = await post(server, { ...ask, sessionId: 's2' })
    expect(first.decision.permissionDecision).toBe('allow')
    expect(second.decision.permissionDecision).toBe('deny')
  })

  it('stops answering once closed', async () => {
    const closing = await createPermissionServer()
    const { url, token } = closing
    await closing.close()
    await expect(
      fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })
    ).rejects.toThrow()
  })
})
