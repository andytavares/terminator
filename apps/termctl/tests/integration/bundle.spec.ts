import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startMcpServer } from '../../../../packages/core-main/src/mcp/mcp-server'
import { toolMarks, type ToolProvider } from '../../../../packages/core-main/src/mcp/tool-types'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

const run = promisify(execFile)
const buildScript = path.resolve(import.meta.dirname, '../../../../scripts/build-termctl.mjs')

let dir: string
let server: { close(): Promise<void> }

const provider: ToolProvider = {
  tools: () => [
    {
      name: 'list_tasks',
      description: 'Lists the tasks',
      inputSchema: { type: 'object', properties: {} },
      ...toolMarks({ destructive: false, readOnly: true }),
      call: async () => [{ id: 't1', title: 'Docs' }],
    },
  ],
}

beforeEach(async () => {
  dir = makeTempDir('termctl-bundle-')
  server = await startMcpServer({
    socketPath: path.join(dir, 'mcp.sock'),
    providers: [provider],
    version: '1.2.3',
  })
})

afterEach(async () => {
  await server.close()
})

describe('the bundled termctl', () => {
  it('runs as a node script with every dependency inside it', async () => {
    const bundle = path.join(dir, 'termctl.mjs')
    await run(process.execPath, [buildScript, bundle])
    const { stdout } = await run(process.execPath, [
      bundle,
      'task',
      'list',
      '--socket',
      path.join(dir, 'mcp.sock'),
    ])
    expect(stdout).toBe('id  title\nt1  Docs\n')
  })
})
