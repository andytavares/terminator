import type { z } from 'zod'
import { createIpcRegistrar } from '@terminator/extension-sdk'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'

/** A thrown handler error, answered as `{ error }` instead of rejecting the invoke. */
export function errorResult(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) }
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
  const { handle, handleRemote, cleanup } = createIpcRegistrar(ctx.api, { onError: errorResult })
  for (const r of routes) {
    const register = r.local ? handle : handleRemote
    register(r.channel, r.schema, (args) => r.run(ctx, args as never))
  }
  return cleanup
}
