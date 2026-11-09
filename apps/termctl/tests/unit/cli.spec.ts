import { describe, it, expect } from 'vitest'
import { main, type CliIo, type ToolClient } from '../../src/cli'
import type { ToolInfo } from '../../src/command-names'
import appToolsJson from '../fixtures/app-tools.json'

// A JSON import types each schema by its literal shape; the app sends them as JSON Schema.
const appTools = appToolsJson as unknown as ToolInfo[]

interface Call {
  name: string
  arguments: Record<string, unknown>
}

function fakeClient(calls: Call[], result: { text: string; isError?: boolean }): ToolClient {
  return {
    listTools: async () => ({ tools: appTools }),
    callTool: async (params) => {
      calls.push(params)
      return { content: [{ type: 'text', text: result.text }], isError: result.isError }
    },
    close: async () => {},
  }
}

function fakeIo(client: ToolClient, overrides: Partial<CliIo> = {}) {
  const output = { stdout: '', stderr: '', socketPaths: [] as string[] }
  const io: CliIo = {
    stdout: { write: (text: string) => (output.stdout += text) },
    stderr: { write: (text: string) => (output.stderr += text) },
    env: {},
    ask: null,
    terminal: null,
    connect: async (socketPath) => {
      output.socketPaths.push(socketPath)
      return client
    },
    ...overrides,
  }
  return { io, output }
}

describe('main: running a tool', () => {
  it('calls the tool and prints its rows as a table, exit 0', async () => {
    const calls: Call[] = []
    const { io, output } = fakeIo(fakeClient(calls, { text: '[{"id":"t1","title":"Docs"}]' }))
    expect(await main(['task', 'list'], io)).toBe(0)
    expect(calls).toEqual([{ name: 'list_tasks', arguments: {} }])
    expect(output.stdout).toBe('id  title\nt1  Docs\n')
  })

  it("passes the flags as the tool's arguments", async () => {
    const calls: Call[] = []
    const { io } = fakeIo(fakeClient(calls, { text: '[]' }))
    expect(await main(['project', 'list', '--workspace-id', 'w1'], io)).toBe(0)
    expect(calls).toEqual([{ name: 'list_projects', arguments: { workspaceId: 'w1' } }])
  })

  it('prints the raw result with --json', async () => {
    const { io, output } = fakeIo(fakeClient([], { text: '[{"id":"t1"}]' }))
    expect(await main(['--json', 'task', 'list'], io)).toBe(0)
    expect(output.stdout).toBe('[{"id":"t1"}]\n')
  })
})

describe('main: errors', () => {
  it('exits 1 with the message on stderr when the tool returns an error', async () => {
    const { io, output } = fakeIo(fakeClient([], { text: 'No task t9', isError: true }))
    expect(await main(['task', 'delete', '--id', 't9', '--yes'], io)).toBe(1)
    expect(output.stderr).toBe('No task t9\n')
    expect(output.stdout).toBe('')
  })

  it('exits 2 on a command that does not exist', async () => {
    const { io, output } = fakeIo(fakeClient([], { text: '[]' }))
    expect(await main(['task', 'explode'], io)).toBe(2)
    expect(output.stderr).toContain('Unknown command "task explode". Run termctl --help.')
  })

  it('exits 2 on a missing required flag, and does not call the tool', async () => {
    const calls: Call[] = []
    const { io, output } = fakeIo(fakeClient(calls, { text: '[]' }))
    expect(await main(['project', 'list'], io)).toBe(2)
    expect(output.stderr).toContain('Missing required flag --workspace-id')
    expect(calls).toEqual([])
  })
})

describe('main: destructive commands', () => {
  it('refuses a destructive command without a terminal, exit 2', async () => {
    const calls: Call[] = []
    const { io, output } = fakeIo(fakeClient(calls, { text: '{}' }))
    expect(await main(['task', 'delete', '--id', 't1'], io)).toBe(2)
    expect(output.stderr).toBe(
      'Refused: "task delete" is destructive. Run it in a terminal to confirm, or pass --yes.\n'
    )
    expect(calls).toEqual([])
  })

  it('runs a destructive command with --yes', async () => {
    const calls: Call[] = []
    const { io } = fakeIo(fakeClient(calls, { text: '{}' }))
    expect(await main(['task', 'delete', '--id', 't1', '--yes'], io)).toBe(0)
    expect(calls).toEqual([{ name: 'delete_task', arguments: { id: 't1' } }])
  })

  it('does not run a destructive command the user declines in a terminal, exit 2', async () => {
    const calls: Call[] = []
    const { io, output } = fakeIo(fakeClient(calls, { text: '{}' }), { ask: async () => 'n' })
    expect(await main(['task', 'delete', '--id', 't1'], io)).toBe(2)
    expect(output.stderr).toBe('Cancelled.\n')
    expect(calls).toEqual([])
  })
})

describe('main: connecting', () => {
  it('exits 3 when it cannot connect', async () => {
    const { io, output } = fakeIo(fakeClient([], { text: '[]' }), {
      connect: async () => {
        throw Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' })
      },
    })
    expect(await main(['task', 'list'], io)).toBe(3)
    expect(output.stderr).toBe('Terminator is not running.\n')
  })

  it('connects to the --socket path, or else to TERMINATOR_MCP_SOCKET', async () => {
    const env = { TERMINATOR_MCP_SOCKET: '/env/mcp.sock' }
    const { io, output } = fakeIo(fakeClient([], { text: '[]' }), { env })
    await main(['task', 'list'], io)
    await main(['task', 'list', '--socket', '/flag/mcp.sock'], io)
    expect(output.socketPaths).toEqual(['/env/mcp.sock', '/flag/mcp.sock'])
  })
})

describe('main: help', () => {
  it('prints the help for --help, a group and a command, exit 0, and calls no tool', async () => {
    const calls: Call[] = []
    const { io, output } = fakeIo(fakeClient(calls, { text: '[]' }))
    expect(await main(['--help'], io)).toBe(0)
    expect(await main(['worktree', '--help'], io)).toBe(0)
    expect(await main(['worktree', 'create', '--help'], io)).toBe(0)
    expect(output.stdout).toContain('Global flags:')
    expect(output.stdout).toContain('Usage: termctl worktree <verb> [flags]')
    expect(output.stdout).toContain('Usage: termctl worktree create [flags]')
    expect(calls).toEqual([])
  })

  it('prints the group help on stderr for a group with no verb, exit 2', async () => {
    const { io, output } = fakeIo(fakeClient([], { text: '[]' }))
    expect(await main(['task'], io)).toBe(2)
    expect(output.stderr).toContain('Usage: termctl task <verb> [flags]')
  })
})
