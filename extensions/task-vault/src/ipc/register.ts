import type { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import type { ExtensionAPI, ExtensionDB, Disposable } from '@terminator/extension-sdk'

/** What every task-vault channel answers to a payload its schema rejects. */
export function validationError(error: z.ZodError): { error: string; message: string } {
  return { error: 'VALIDATION_ERROR', message: error.message }
}

/** A thrown handler error, answered as `{ error }` instead of rejecting the invoke. */
export function errorResult(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) }
}

type Register = <S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (args: z.infer<S>) => Promise<unknown> | unknown
) => void

// All task-vault IPC channels register through the ExtensionAPI — never through
// ipcMain directly (Extension Isolation). Each declares the schema its payload
// is parsed with before `run` sees it (ADR 096). A channel is local-only
// unless it registers through handleRemote. With `onError`, a channel whose
// run throws answers with it instead of rejecting.
export function createIpcRegistrar(
  api: ExtensionAPI,
  onError?: (err: unknown) => unknown
): {
  handle: Register
  /** Like `handle`, and also reachable from the remote browser client. */
  handleRemote: Register
  cleanup(): void
} {
  const disposables: Disposable[] = []
  const register =
    (remoteAccessible: boolean): Register =>
    (channel, schema, run) => {
      const spec = defineChannel({ channel, schema, invalid: validationError, run, onError })
      disposables.push(api.ipc.registerHandler(spec, { remoteAccessible }))
    }
  return {
    handle: register(false),
    handleRemote: register(true),
    cleanup() {
      disposables.forEach((d) => d.dispose())
    },
  }
}

/** What a route handler gets besides its payload. */
export interface IpcContext {
  api: ExtensionAPI
  db: ExtensionDB
}

/** One channel: its payload schema, its handler, and whether it stays desktop-only. */
export interface Route {
  channel: string
  schema: z.ZodType
  run: (ctx: IpcContext, args: never) => unknown
  local?: boolean
}

/** A channel the remote browser client may also call. */
export function route<S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (ctx: IpcContext, args: z.infer<S>) => unknown
): Route {
  return { channel, schema, run }
}

/** A channel reachable from the desktop only. */
export function localRoute<S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (ctx: IpcContext, args: z.infer<S>) => unknown
): Route {
  return { channel, schema, run, local: true }
}

/** Registers every route with `errorResult` as its error answer; returns the cleanup. */
export function registerRoutes(ctx: IpcContext, routes: readonly Route[]): () => void {
  const { handle, handleRemote, cleanup } = createIpcRegistrar(ctx.api, errorResult)
  for (const r of routes) {
    const register = r.local ? handle : handleRemote
    register(r.channel, r.schema, (args) => r.run(ctx, args as never))
  }
  return cleanup
}
