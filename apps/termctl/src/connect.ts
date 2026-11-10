import { connect } from 'node:net'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/client'
import { SocketTransport } from './socket-transport.js'
import type { ToolClient, ToolResult } from './cli.js'
import type { ToolInfo } from './command-names.js'

/** An MCP client on the Terminator socket. Rejects when nothing listens there. */
export async function connectToTerminator(socketPath: string): Promise<ToolClient> {
  const socket = connect(socketPath)
  await once(socket, 'connect')
  const client = new Client({ name: 'termctl', version: '1.0.0' })
  await client.connect(
    new SocketTransport(socket, {
      sessionId: null,
      claudePid: process.ppid,
      projectDir: process.cwd(),
      terminalId: process.env.TERMINATOR_SESSION_ID ?? null,
    })
  )
  return {
    // The SDK types a schema as any JSON value; the server sends JSON Schema objects.
    listTools: async () => (await client.listTools()) as unknown as { tools: ToolInfo[] },
    callTool: async (params) => (await client.callTool(params)) as ToolResult,
    close: () => client.close(),
  }
}
