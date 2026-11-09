import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import {
  McpCallerSchema,
  type McpCaller,
  type McpToolDef,
  type ToolProvider,
} from './tool-types.js'

// The Terminator MCP server (ADR 145): one Unix socket, one MCP session per relay connection.
// The relay's first line names the caller; every byte after it is MCP over stdio framing.

// A hello is a few hundred bytes; a peer that sends this much without a newline is not a relay.
const HELLO_LIMIT_BYTES = 64 * 1024

export interface McpServerOptions {
  socketPath: string
  providers: ToolProvider[]
  /** The app's version, reported to Claude Code as the server's. */
  version: string
}

interface ToolCallParams {
  name: string
  arguments?: Record<string, unknown>
}

export async function startMcpServer(
  options: McpServerOptions
): Promise<{ close(): Promise<void> }> {
  // A socket file outlives a crash, and listen() refuses a path that exists.
  await fs.rm(options.socketPath, { force: true })
  const sockets = new Set<net.Socket>()
  const listener = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    readHello(socket)
      .then((caller) => serve(socket, caller, options))
      .catch(() => socket.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(options.socketPath, resolve)
  })
  await fs.chmod(options.socketPath, 0o600)
  return { close: () => closeListener(listener, sockets) }
}

/** The first line, parsed. The socket is left paused with every later byte still unread. */
function readHello(socket: net.Socket): Promise<McpCaller> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf(0x0a)
      if (end === -1) {
        if (buffered.length > HELLO_LIMIT_BYTES) reject(new Error('The hello has no end'))
        return
      }
      socket.off('data', onData)
      socket.pause()
      if (end + 1 < buffered.length) socket.unshift(buffered.subarray(end + 1))
      try {
        resolve(McpCallerSchema.parse(JSON.parse(buffered.subarray(0, end).toString('utf8'))))
      } catch (error) {
        reject(error)
      }
    }
    socket.on('data', onData)
    socket.once('close', () => reject(new Error('The relay left before its hello')))
  })
}

async function serve(
  socket: net.Socket,
  caller: McpCaller,
  options: McpServerOptions
): Promise<void> {
  const server = new Server(
    { name: 'terminator', version: options.version },
    { capabilities: { tools: {} } }
  )
  server.setRequestHandler('tools/list', () => ({
    tools: allTools(options.providers).map(listedTool),
  }))
  server.setRequestHandler('tools/call', (request) =>
    callTool(options.providers, request.params, caller)
  )
  await server.connect(new StdioServerTransport(socket, socket))
  // Paused by readHello; adding the transport's listener does not restart a paused stream.
  socket.resume()
}

function allTools(providers: ToolProvider[]): McpToolDef[] {
  return providers.flatMap((provider) => provider.tools())
}

function listedTool(tool: McpToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
    annotations: tool.annotations,
    ...(tool._meta ? { _meta: tool._meta } : {}),
  }
}

async function callTool(providers: ToolProvider[], params: ToolCallParams, caller: McpCaller) {
  const tool = allTools(providers).find((candidate) => candidate.name === params.name)
  if (!tool) return failure(`Terminator has no tool named ${params.name}`)
  try {
    const result = await tool.call(params.arguments ?? {}, caller)
    const message = envelopeMessage(result)
    if (message !== null) return failure(message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) ?? 'null' }] }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

/** The message of an IPC error envelope: `{ error, message? }`. Null for any other result. */
function envelopeMessage(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const { error, message } = result as { error?: unknown; message?: unknown }
  if (typeof error !== 'string') return null
  return typeof message === 'string' ? message : error
}

function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

async function closeListener(listener: net.Server, sockets: Set<net.Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => listener.close(() => resolve()))
}
