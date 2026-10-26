// Stand-in ACP agent for e2e runs, seeded as the `claude` agent (tests/e2e/helpers.ts), so no run
// starts the real Claude adapter. A prompt answers with the file E2E_AGENT_REPLY names when a spec
// has written it; otherwise the turn stays open until the client cancels, as a working agent's does.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const MODES = ['default', 'acceptEdits', 'auto']
const CONFIG_OPTIONS = [
  {
    id: 'mode',
    name: 'Mode',
    type: 'select',
    currentValue: 'default',
    options: MODES.map((value) => ({ value, name: value })),
  },
  {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'stub-model',
    options: [{ value: 'stub-model', name: 'Stub model' }],
  },
]

const cancels = new Map()

function reply() {
  const file = process.env.E2E_AGENT_REPLY
  return file && existsSync(file) ? readFileSync(file, 'utf8') : null
}

function agent(connection) {
  return {
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }),
    authenticate: async () => ({}),
    newSession: async () => ({ sessionId: randomUUID(), configOptions: CONFIG_OPTIONS }),
    loadSession: async () => ({ configOptions: CONFIG_OPTIONS }),
    setSessionMode: async () => ({}),
    setSessionConfigOption: async () => ({ configOptions: CONFIG_OPTIONS }),
    cancel: async ({ sessionId }) => cancels.get(sessionId)?.(),
    prompt: async ({ sessionId, prompt }) => {
      const asked = prompt.map((block) => block.text ?? '').join(' ')
      const text = reply() ?? `acp-stub: ${asked.slice(0, 200)}`
      await connection.sessionUpdate({
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
      })
      if (reply() !== null) return { stopReason: 'end_turn' }
      await new Promise((resolve) => cancels.set(sessionId, resolve))
      return { stopReason: 'cancelled' }
    },
  }
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
new AgentSideConnection(agent, stream)
