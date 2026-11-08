import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// Claude Code starts this as a stdio MCP server; it carries the bytes to Terminator's socket
// (ADR 145). Written at startup (ADR-026): a loose file beside the bundle vanishes when packaged.

const SCRIPT_NAME = 'mcp-relay.cjs'

/** The relay. argv[2] is the socket. Node built-ins only: Electron runs it in node mode. */
const RELAY_SCRIPT = `// Written by Terminator. Do not edit: it is overwritten on every start.
const net = require('net')
const socket = net.connect(process.argv[2])
socket.on('connect', () => {
  const hello = {
    sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    claudePid: process.ppid,
    projectDir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  }
  socket.write(JSON.stringify(hello) + '\\n')
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})
socket.on('error', (error) => {
  const down = error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
  process.stderr.write(down ? 'Terminator is not running\\n' : 'Terminator relay: ' + error.message + '\\n')
  process.exit(1)
})
socket.on('close', () => process.exit(0))
process.stdin.on('end', () => socket.end())
`

/** Write the relay and return its absolute path. */
export async function installRelayScript(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, SCRIPT_NAME)
  await fs.writeFile(target, RELAY_SCRIPT, 'utf8')
  return target
}
