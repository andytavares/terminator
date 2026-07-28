import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'

// How a permission request gets from the agent's terminal back to the console.
//
// The agent no longer runs inside this process, so there is no callback to
// hand it. It runs `claude` in a terminal you can see, and Claude Code's
// PreToolUse hook is the only thing that can hold a tool call still while a
// human decides — the hook is a command, and the tool waits for it to exit.
//
// So the hook posts here and the response is deliberately withheld until the
// operator answers. One connection is one blocked tool call. The socket is the
// backpressure: nothing polls, nothing times out on our side, and when the
// operator answers, the reply unblocks the agent within a round trip on
// loopback.
//
// Bound to 127.0.0.1 on an ephemeral port with a bearer token minted per run.
// Anything on the machine could otherwise approve an agent's tool calls, and
// the whole point of the request is that a human decides.

/**
 * What the console answers a blocked tool call with.
 *
 * This is our wire shape, not the runtime's — the script translates. Verified
 * against claude 2.1.220 rather than taken from the reference, because the
 * published examples disagree with the binary in two ways that both fail
 * silently: the decision must carry `hookEventName` or it is ignored entirely
 * and the tool proceeds, and the words back to the agent travel as
 * `permissionDecisionReason`, not `systemMessage`.
 */
export interface HookDecision {
  permissionDecision: 'allow' | 'deny' | 'ask'
  /** Returned on allow; the agent proceeds with this rather than the original. */
  updatedInput?: unknown
  /** The only channel that carries words back to the agent. */
  reason?: string
}

export interface HookRequest {
  /** The console's session id, passed on the hook command line. */
  sessionId: string
  toolName: string
  input: unknown
}

/** Decides one tool call, resolving whenever the operator does — possibly never. */
export type PermissionHandler = (request: HookRequest) => Promise<HookDecision>

export interface PermissionServer {
  /** Where the hook posts. Known only after listening, so it is read, not built. */
  readonly url: string
  readonly token: string
  /** Registers the decider for one session. Returns a disposer. */
  register(sessionId: string, handler: PermissionHandler): () => void
  close(): Promise<void>
}

/**
 * Falling back to `ask` rather than `allow` or `deny`.
 *
 * `ask` hands the decision to Claude Code's own prompt, in the terminal the
 * operator is looking at. That is the safe default in both directions: nothing
 * is approved behind their back, and nothing is refused because the console
 * happened to be restarting. It is only viable because there *is* a terminal
 * now — headless, the same fallback would have hung the agent.
 */
const FALL_BACK_TO_THE_TERMINAL: HookDecision = { permissionDecision: 'ask' }

const MAX_BODY_BYTES = 1_000_000

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      // A hook input carries whatever the agent passed the tool, which can be a
      // whole file. Bounded anyway: this port is reachable by any process on
      // the machine, and an unbounded read is a way to exhaust the app.
      if (body.length > MAX_BODY_BYTES) reject(new Error('hook payload too large'))
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function parseRequest(body: string): HookRequest | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const sessionId = record.sessionId
  const toolName = record.toolName
  if (typeof sessionId !== 'string' || sessionId === '') return null
  if (typeof toolName !== 'string' || toolName === '') return null
  return { sessionId, toolName, input: record.input }
}

function send(response: ServerResponse, status: number, decision: HookDecision): void {
  const body = JSON.stringify(decision)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

export async function createPermissionServer(): Promise<PermissionServer> {
  const token = randomBytes(32).toString('hex')
  const handlers = new Map<string, PermissionHandler>()

  const server: Server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/pretooluse') {
        send(response, 404, FALL_BACK_TO_THE_TERMINAL)
        return
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        send(response, 401, FALL_BACK_TO_THE_TERMINAL)
        return
      }

      let asked: HookRequest | null
      try {
        asked = parseRequest(await readBody(request))
      } catch {
        send(response, 400, FALL_BACK_TO_THE_TERMINAL)
        return
      }
      if (asked === null) {
        send(response, 400, FALL_BACK_TO_THE_TERMINAL)
        return
      }

      const handler = handlers.get(asked.sessionId)
      if (handler === undefined) {
        // A session the console does not know about — it restarted, or the
        // terminal outlived the run. The operator can still answer in the
        // terminal, so the agent is not stuck.
        send(response, 200, FALL_BACK_TO_THE_TERMINAL)
        return
      }

      // The connection stays open here, for as long as it takes.
      let decided: HookDecision
      try {
        decided = await handler(asked)
      } catch {
        decided = FALL_BACK_TO_THE_TERMINAL
      }
      if (!response.writableEnded) send(response, 200, decided)
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Loopback only. A hook running on this machine is the only caller there
    // should ever be.
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/pretooluse`,
    token,

    register(sessionId: string, handler: PermissionHandler): () => void {
      handlers.set(sessionId, handler)
      return () => handlers.delete(sessionId)
    },

    async close(): Promise<void> {
      handlers.clear()
      await new Promise<void>((resolve) => {
        // Closes the listener; a hook still waiting on a decision is severed,
        // and its script falls back to the terminal prompt.
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
    },
  }
}
