// Stand-in ACP agent for e2e, seeded as `claude` (tests/e2e/helpers.ts). Requests are appended to
// the file its first argument names. Foundry's roles get scripted answers in the real adapter's shape
// (see answerWithProposal, answerRung, writeUnitFile); any other prompt behaves as described there.
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk'
import { SessionModeManager } from '@agentclientprotocol/claude-agent-acp/dist/session-mode.js'

// The modes the real adapter offers, so a mode it would refuse is refused here too.
const MODES = new SessionModeManager({ airClient: () => false })
  .buildAvailableModes(false)
  .map((mode) => mode.id)
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
const sessions = new Map()
const PROPOSAL = join(dirname(fileURLToPath(import.meta.url)), 'stub-proposal.json')
const RECORD = process.argv[2]

function record(entry) {
  if (RECORD) appendFileSync(RECORD, `${JSON.stringify(entry)}\n`)
}

// A spec's reply ends the turn; with none the turn stays open until cancelled, like a working agent.
function reply() {
  const file = process.env.E2E_AGENT_REPLY
  return file && existsSync(file) ? readFileSync(file, 'utf8') : null
}

const sessionHandlers = {
  newSession: async ({ cwd, _meta }) => {
    const sessionId = randomUUID()
    const inherited = Boolean(process.env.CLAUDE_CODE_BRIDGE_SESSION_ID)
    sessions.set(sessionId, { cwd, meta: _meta })
    record({ kind: 'session', sessionId, cwd, meta: _meta ?? null, inherited })
    return { sessionId, configOptions: CONFIG_OPTIONS }
  },
  loadSession: async ({ sessionId, cwd, _meta }) => {
    sessions.set(sessionId, { cwd, meta: _meta })
    record({ kind: 'session', sessionId, cwd, meta: _meta ?? null, resumed: true })
    return { configOptions: CONFIG_OPTIONS }
  },
  setSessionMode: async ({ sessionId, modeId }) => {
    if (!MODES.includes(modeId))
      throw RequestError.internalError({
        details: `Mode ${modeId} is not available in this session`,
      })
    record({ kind: 'mode', sessionId, modeId })
    return {}
  },
  setSessionConfigOption: async () => ({ configOptions: CONFIG_OPTIONS }),
}

/** The architect's answer: the proposal as a completed `StructuredOutput` tool call. */
async function answerWithProposal(connection, { sessionId, asked }) {
  const repo = /^- `([^`]+)` — base/m.exec(asked)?.[1] ?? 'fixture'
  const rawInput = JSON.parse(readFileSync(PROPOSAL, 'utf8').replaceAll('@REPO@', repo))
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: randomUUID(),
      title: 'StructuredOutput',
      status: 'completed',
      rawInput,
      _meta: { claudeCode: { toolName: 'StructuredOutput' } },
    },
  })
}

/** A read-only rung's clean answer, at the path its prompt names. */
function writeRungAnswer(output, asked) {
  const body = asked.includes('"redTeam": [')
    ? { redTeam: [], anotherPass: false }
    : { findings: { entryPoints: ['README.md'] } }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ ...body, note: 'acp-stub: nothing to report' }))
}

function writeUnitFile(cwd, touched) {
  mkdirSync(dirname(join(cwd, touched)), { recursive: true })
  writeFileSync(join(cwd, touched), 'Added by the stub agent.\n')
}

/** Acts on a Line rung's prompt; says whether the prompt was one. */
function answerRung(asked, cwd) {
  const output = /Write a single JSON object to `([^`]+)`/.exec(asked)?.[1]
  if (output) writeRungAnswer(output, asked)
  // Builds only when asked to: a builder that ends its turn closes its tab, which specs
  // that look at a working builder need open.
  if (process.env.E2E_AGENT_BUILDS !== '1') return Boolean(output)
  const touched = /^## The units?:/m.test(asked) ? /It touches: `([^`]+)`/.exec(asked)?.[1] : null
  if (touched) writeUnitFile(cwd, touched)
  return Boolean(output || touched || asked.startsWith('Keep the written record in step'))
}

/** The answer a scripted prompt gets, or null for a prompt that is not one. */
async function scripted(connection, { sessionId, asked }) {
  const session = sessions.get(sessionId)
  if (session?.meta?.claudeCode?.options?.outputFormat?.schema) {
    await answerWithProposal(connection, { sessionId, asked })
    return 'drafted the plan'
  }
  return answerRung(asked, session?.cwd) ? 'acp-stub: answered' : null
}

/** Answers with the reply file when there is one; otherwise works until it is cancelled. */
function prompter(connection) {
  return async ({ sessionId, prompt }) => {
    const asked = prompt.map((block) => block.text ?? '').join(' ')
    record({ kind: 'prompt', sessionId, length: asked.length })
    const done = await scripted(connection, { sessionId, asked })
    const text = done ?? reply() ?? `acp-stub: ${asked.slice(0, 200)}`
    await connection.sessionUpdate({
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    })
    if (done !== null || reply() !== null) return { stopReason: 'end_turn' }
    await new Promise((resolve) => cancels.set(sessionId, resolve))
    return { stopReason: 'cancelled' }
  }
}

function agent(connection) {
  return {
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }),
    authenticate: async () => ({}),
    ...sessionHandlers,
    cancel: async ({ sessionId }) => cancels.get(sessionId)?.(),
    prompt: prompter(connection),
  }
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
new AgentSideConnection(agent, stream)
