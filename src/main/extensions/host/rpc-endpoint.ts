/**
 * The extension host's wire (ADR 094): requests that are answered, and events
 * that are not, over one MessagePort. Main and the extension host each hold one
 * endpoint; either side can call the other.
 */
import type { MessagePortMain } from 'electron'

export type RpcMessage =
  | { kind: 'request'; id: number; method: string; params: unknown[] }
  | { kind: 'response'; id: number; result?: unknown; error?: RpcErrorShape }
  | { kind: 'event'; method: string; params: unknown[] }

/** An error as it crosses: only `name` and `message`, so a caller can still tell a
 * MissingCwdError or a CwdOutOfScopeError, and nothing else of it leaks. */
interface RpcErrorShape {
  name: string
  message: string
}

/** A port as both sides see it: Electron's MessagePortMain, or a Node MessagePort in tests. */
export interface MessageLink {
  post(message: RpcMessage): void
  listen(receive: (message: RpcMessage) => void): void
}

/** Electron's MessagePortMain as a link. */
export function messagePortLink(port: MessagePortMain): MessageLink {
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => port.on('message', (event) => receive(event.data as RpcMessage)),
  }
}

type Handler = (...params: never[]) => unknown

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

function toErrorShape(error: unknown): RpcErrorShape {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}

function fromErrorShape(shape: RpcErrorShape): Error {
  const error = new Error(shape.message)
  error.name = shape.name
  return error
}

export class RpcEndpoint {
  private readonly handlers = new Map<string, Handler>()
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor(
    private readonly link: MessageLink,
    private readonly onEventError: (method: string, error: unknown) => void = () => {}
  ) {
    link.listen((message) => this.receive(message))
  }

  handle(method: string, handler: Handler): void {
    this.handlers.set(method, handler)
  }

  request(method: string, ...params: unknown[]): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.link.post({ kind: 'request', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, ...params: unknown[]): void {
    this.link.post({ kind: 'event', method, params })
  }

  /** Rejects every request still waiting: the other side is gone and will never answer. */
  failPending(reason: string): void {
    for (const { reject } of this.pending.values()) reject(new Error(reason))
    this.pending.clear()
  }

  private receive(message: RpcMessage): void {
    if (message.kind === 'response') return this.settle(message)
    if (message.kind === 'request') return void this.answer(message)
    const reportEventError = (error: unknown) => this.onEventError(message.method, error)
    try {
      Promise.resolve(this.invoke(message.method, message.params)).catch(reportEventError)
    } catch (error) {
      reportEventError(error)
    }
  }

  private settle(message: Extract<RpcMessage, { kind: 'response' }>): void {
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) pending.reject(fromErrorShape(message.error))
    else pending.resolve(message.result)
  }

  private async answer(message: Extract<RpcMessage, { kind: 'request' }>): Promise<void> {
    try {
      const result = await this.invoke(message.method, message.params)
      this.link.post({ kind: 'response', id: message.id, result })
    } catch (error) {
      this.link.post({ kind: 'response', id: message.id, error: toErrorShape(error) })
    }
  }

  private invoke(method: string, params: unknown[]): unknown {
    const handler = this.handlers.get(method)
    if (!handler) throw new Error(`No handler for "${method}"`)
    return handler(...(params as never[]))
  }
}
