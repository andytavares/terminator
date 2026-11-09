import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { main, type CliIo } from '../../src/cli'
import { connectToTerminator } from '../../src/connect'
import { startMcpServer } from '../../../../packages/core-main/src/mcp/mcp-server'
import { toolMarks, type ToolProvider } from '../../../../packages/core-main/src/mcp/tool-types'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

let socketPath: string
let server: { close(): Promise<void> }
const deleted: string[] = []

type Tool = ReturnType<ToolProvider['tools']>[number]

const readTools: Tool[] = [
  {
    name: 'list_tasks',
    description: 'Lists the tasks',
    inputSchema: { type: 'object', properties: {} },
    ...toolMarks({ destructive: false, readOnly: true }),
    call: async () => [{ id: 't1', title: 'Docs', done: false }],
  },
  {
    name: 'list_projects',
    description: 'Lists the projects of a workspace',
    inputSchema: {
      type: 'object',
      properties: { workspaceId: { type: 'string' }, limit: { type: 'integer' } },
      required: ['workspaceId'],
    },
    ...toolMarks({ destructive: false, readOnly: true }),
    call: async (args) => ({ received: args }),
  },
]

const writeTools: Tool[] = [
  {
    name: 'delete_task',
    description: 'Deletes a task',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    ...toolMarks({ destructive: true, readOnly: false }),
    call: async (args) => {
      deleted.push(String(args.id))
      return { ok: true }
    },
  },
  {
    name: 'get_issue',
    description: 'Reads an issue',
    inputSchema: { type: 'object', properties: {} },
    ...toolMarks({ destructive: false, readOnly: true }),
    call: async () => ({ error: 'not-found', message: 'No issue ABC-1' }),
  },
]

const provider: ToolProvider = { tools: () => [...readTools, ...writeTools] }

beforeEach(async () => {
  socketPath = path.join(makeTempDir('termctl-'), 'mcp.sock')
  server = await startMcpServer({ socketPath, providers: [provider], version: '1.2.3' })
  deleted.length = 0
})

afterEach(async () => {
  await server.close()
})

function realIo() {
  const output = { stdout: '', stderr: '' }
  const io: CliIo = {
    stdout: { write: (text: string) => (output.stdout += text) },
    stderr: { write: (text: string) => (output.stderr += text) },
    env: { TERMINATOR_MCP_SOCKET: socketPath },
    ask: null,
    terminal: null,
    connect: connectToTerminator,
  }
  return { io, output }
}

describe('termctl on a socket: running tools', () => {
  it('runs a read-only tool and prints its rows as a table', async () => {
    const { io, output } = realIo()
    expect(await main(['task', 'list'], io)).toBe(0)
    expect(output.stdout).toBe('id  title  done\nt1  Docs   false\n')
  })

  it('sends the flags as the arguments, and prints the raw result with --json', async () => {
    const { io, output } = realIo()
    const argv = ['project', 'list', '--workspace-id', 'w1', '--limit', '3', '--json']
    expect(await main(argv, io)).toBe(0)
    expect(output.stdout).toBe('{"received":{"workspaceId":"w1","limit":3}}\n')
  })

  it('refuses a destructive tool without a terminal, and the tool does not run', async () => {
    const { io, output } = realIo()
    expect(await main(['task', 'delete', '--id', 't1'], io)).toBe(2)
    expect(output.stderr).toContain('Refused: "task delete" is destructive.')
    expect(deleted).toEqual([])
  })

  it('runs a destructive tool with --yes', async () => {
    const { io } = realIo()
    expect(await main(['task', 'delete', '--id', 't1', '--yes'], io)).toBe(0)
    expect(deleted).toEqual(['t1'])
  })
})

describe('termctl on a socket: failures', () => {
  it("exits 1 with the tool's error message on stderr", async () => {
    const { io, output } = realIo()
    expect(await main(['issue', 'get'], io)).toBe(1)
    expect(output.stderr).toBe('No issue ABC-1\n')
  })

  it('exits 3 when nothing listens on the socket', async () => {
    const { io, output } = realIo()
    const missing = path.join(makeTempDir('termctl-'), 'mcp.sock')
    expect(await main(['task', 'list', '--socket', missing], io)).toBe(3)
    expect(output.stderr).toBe('Terminator is not running.\n')
  })
})
