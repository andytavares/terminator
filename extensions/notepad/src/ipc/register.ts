import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'

/** What every notepad channel answers to a payload its schema rejects. */
export const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

/** Payload of a channel that acts on one row, named by its id. */
export const IdPayload = z.object({ id: z.string() })

type Register = <S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (args: z.infer<S>) => Promise<unknown> | unknown
) => void

// All notepad IPC channels register through the ExtensionAPI — never through
// ipcMain directly (Extension Isolation). Each declares the schema its payload
// is parsed with before `run` sees it (ADR 096). A channel is local-only
// unless it registers through handleRemote.
export function createIpcRegistrar(api: ExtensionAPI): {
  handle: Register
  /** Like `handle`, and also reachable from the remote browser client. */
  handleRemote: Register
  cleanup(): void
} {
  const disposables: Disposable[] = []
  const registrarFor =
    (remoteAccessible: boolean): Register =>
    (channel, schema, run) => {
      const spec = defineChannel({ channel, schema, invalid: VALIDATION_ERROR, run })
      disposables.push(api.ipc.registerHandler(spec, { remoteAccessible }))
    }
  return {
    handle: registrarFor(false),
    handleRemote: registrarFor(true),
    cleanup() {
      disposables.forEach((d) => d.dispose())
    },
  }
}
