import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startMcpServer } from '../../../src/mcp/mcp-server'
import { installRelayScript } from '../../../src/mcp/relay-script'
import { toolMarks, type McpCaller, type ToolProvider } from '../../../src/mcp/tool-types'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

let socketPath: string
let relayPath: string
let server: { close(): Promise<void> }
let client: Client | null
const calls: Array<{ args: Record<string, unknown>; caller: McpCaller }> = []

const provider: ToolProvider = {
  tools: () => [
    {
      name: 'echo',
      description: 'Echoes the text',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      ...toolMarks({ destructive: false, readOnly: true }),
      call: async (args, caller) => {
        calls.push({ args, caller })
        return { echoed: args.text }
      },
    },
    {
      name: 'remove_thing',
      description: 'Removes a thing',
      inputSchema: { type: 'object' },
      ...toolMarks({ destructive: true, readOnly: false }),
      call: async () => ({ error: 'failed', message: 'The thing is gone already' }),
    },
    {
      name: 'explode',
      description: 'Throws',
      inputSchema: { type: 'object' },
      ...toolMarks({ destructive: false, readOnly: false }),
      call: async () => {
        throw new Error('exploded')
      },
    },
  ],
}

beforeEach(async () => {
  const dir = makeTempDir('mcp-')
  socketPath = path.join(dir, 'mcp.sock')
  relayPath = await installRelayScript(path.join(dir, 'mcp'))
  server = await startMcpServer({ socketPath, providers: [provider], version: '1.2.3' })
  client = null
  calls.length = 0
})

afterEach(async () => {
  await client?.close()
  await server.close()
})

async function connectClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [relayPath, socketPath],
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 's1' } as Record<string, string>,
  })
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(transport)
  return client
}

describe('startMcpServer — through the real relay', () => {
  it('lists every provider tool with its marks', async () => {
    const { tools } = await (await connectClient()).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(['echo', 'remove_thing', 'explode'])
    expect(tools[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
    expect(tools[1].annotations).toEqual({ destructiveHint: true })
    expect(tools[1]._meta).toEqual({ 'anthropic/requiresUserInteraction': true })
    expect(tools[2].annotations).toEqual({ destructiveHint: false })
  })

  it('runs a tool with the caller the relay announced', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ echoed: 'hi' }) }])
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ text: 'hi' })
    expect(calls[0].caller).toMatchObject({ sessionId: 's1', claudePid: process.pid })
  })

  it('turns an error envelope into an error result with its message', async () => {
    const result = await (await connectClient()).callTool({ name: 'remove_thing', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'The thing is gone already' }])
  })

  it('turns a thrown error into an error result', async () => {
    const result = await (await connectClient()).callTool({ name: 'explode', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'exploded' }])
  })
})

describe('startMcpServer — the socket', () => {
  it('is readable and writable by its owner only', () => {
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600)
  })

  it.each(['not json\n', '{"sessionId": 5}\n'])('refuses the bad hello %j', async (hello) => {
    const socket = net.connect(socketPath)
    await once(socket, 'connect')
    socket.write(hello)
    await once(socket, 'close')
    expect(socket.destroyed).toBe(true)
  })

  it('replaces a stale socket file left by an earlier run', async () => {
    await server.close()
    fs.writeFileSync(socketPath, '')
    server = await startMcpServer({ socketPath, providers: [provider], version: '1.2.3' })
    const { tools } = await (await connectClient()).listTools()
    expect(tools).toHaveLength(3)
  })
})
