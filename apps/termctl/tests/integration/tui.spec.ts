import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { main } from '../../src/cli'
import { connectToTerminator } from '../../src/connect'
import { startMcpServer } from '../../../../packages/core-main/src/mcp/mcp-server'
import { toolMarks, type ToolProvider } from '../../../../packages/core-main/src/mcp/tool-types'
import { eventually } from '../../../../packages/test-support/src/eventually'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

let socketPath: string
let server: { close(): Promise<void> }

const provider: ToolProvider = {
  tools: () => [
    {
      name: 'list_tasks',
      description: 'Lists the tasks',
      inputSchema: { type: 'object', properties: {} },
      ...toolMarks({ destructive: false, readOnly: true }),
      call: async () => ({ data: [{ id: 't1', title: 'Docs', branch: 'docs' }] }),
    },
  ],
}

beforeEach(async () => {
  socketPath = path.join(makeTempDir('termctl-tui-'), 'mcp.sock')
  server = await startMcpServer({ socketPath, providers: [provider], version: '1.2.3' })
})

afterEach(async () => {
  await server.close()
})

function fakeTerminal() {
  const writes: string[] = []
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin })
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        writes.push(String(chunk))
        done()
      },
    }),
    { columns: 100, rows: 28 }
  )
  const clock = { now: () => 0, every: () => () => {} }
  const lastFrame = () =>
    stripVTControlCharacters(writes.filter((text) => text.trim() !== '').at(-1) ?? '')
  return { terminal: { stdin, stdout, cwd: '/work', home: '/home/me', clock }, stdin, lastFrame }
}

describe('the full-screen view against the Terminator MCP server on a socket', () => {
  it('shows the tasks from the socket, moves to the rows pane, and exits 0 on q', async () => {
    const { terminal, stdin, lastFrame } = fakeTerminal()
    const io = {
      stdout: { write: () => true },
      stderr: { write: () => true },
      env: { TERMINATOR_MCP_SOCKET: socketPath },
      ask: null,
      terminal,
      connect: connectToTerminator,
    }
    const exit = main([], io)
    await eventually(() => expect(lastFrame()).toMatch(/Tasks\s+1/))
    stdin.write('\t')
    await eventually(() => expect(lastFrame()).toMatch(/branch\s+docs/))
    stdin.write('q')
    expect(await exit).toBe(0)
  })
})
