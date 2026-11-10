import type { Socket } from 'node:net'
import {
  ReadBuffer,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/client'

/** Who is calling, sent as the first line: the server's McpCallerSchema. */
export interface Hello {
  sessionId: string | null
  claudePid: number
  projectDir: string
  terminalId: string | null
}

/** MCP over a connected Unix socket, as the relay speaks it: a hello line, then JSON-RPC lines. */
export class SocketTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private readonly buffer = new ReadBuffer()

  constructor(
    private readonly socket: Socket,
    private readonly hello: Hello
  ) {}

  async start(): Promise<void> {
    this.socket.on('data', (chunk: Buffer) => this.receive(chunk))
    this.socket.on('error', (error) => this.onerror?.(error))
    this.socket.on('close', () => this.onclose?.())
    this.socket.write(`${JSON.stringify(this.hello)}\n`)
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.socket.write(serializeMessage(message))
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) return
    const closed = new Promise((resolve) => this.socket.once('close', resolve))
    this.socket.end()
    await closed
  }

  private receive(chunk: Buffer): void {
    this.buffer.append(chunk)
    try {
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) {
        this.onmessage?.(message)
      }
    } catch (error) {
      this.onerror?.(error as Error)
    }
  }
}
