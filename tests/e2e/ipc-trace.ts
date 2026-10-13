import { test, type ElectronApplication } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

// Records which IPC channels a spec drives in the real app, the evidence behind
// docs/research/feature-coverage.md. Off unless E2E_IPC_TRACE names a directory:
//
//   E2E_IPC_TRACE=/tmp/trace npx playwright test --workers=1
//
// writes one <spec>.jsonl per spec file there. Each line is
// [kind, channel, payload]: an invoke or send from a renderer, or an event main
// pushed to one. The payload is kept only for the channels that name what ran,
// a command or a setting.

/** Channels whose payload says which command ran or which setting changed. */
const NAMING_CHANNELS = [
  'extension:execute-command',
  'extension:run-command',
  'extension:update-setting',
  'extension:update-workspace-setting',
  'settings:update-global',
  'settings:update-workspace',
]

function traceDirectory(): string | undefined {
  return process.env.E2E_IPC_TRACE || undefined
}

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

/**
 * Runs in the main process, so it names nothing outside itself: Playwright sends
 * its source text, not the function.
 */
function installIpcTrace(
  { app: electronApp, ipcMain, webContents }: typeof import('electron'),
  naming: string[]
): void {
  const seen = new Set<string>()
  Object.assign(globalThis, { __ipcTrace: seen })
  const note = (kind: string, channel: string, payload?: unknown) =>
    seen.add(JSON.stringify([kind, channel, naming.includes(channel) ? payload : null]))
  // Electron keeps ipcMain.handle's handlers in this map and reads it on every invoke.
  const handlers: Map<string, IpcHandler> = Reflect.get(ipcMain, '_invokeHandlers')
  const traced = (channel: string, handler: IpcHandler): IpcHandler => {
    return (event, ...args) => (note('invoke', channel, args[0]), handler(event, ...args))
  }
  for (const [channel, handler] of handlers) handlers.set(channel, traced(channel, handler))
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => handle(channel, traced(channel, handler as IpcHandler))
  const emit = ipcMain.emit.bind(ipcMain)
  ipcMain.emit = (channel: string | symbol, ...args: unknown[]) => {
    if (typeof channel === 'string') note('send', channel, args[1])
    return emit(channel, ...args)
  }
  const tracePushes = (contents: Electron.WebContents) => {
    const send = contents.send
    contents.send = function (channel: string, ...args: unknown[]) {
      note('event', channel)
      return send.call(this, channel, ...args)
    }
  }
  webContents.getAllWebContents().forEach(tracePushes)
  electronApp.on('web-contents-created', (_event, contents) => tracePushes(contents))
}

/** Wraps every invoke handler, send listener and webContents.send in the app's main process. */
export async function startIpcTrace(app: ElectronApplication): Promise<void> {
  if (!traceDirectory()) return
  await app.evaluate(installIpcTrace, NAMING_CHANNELS)
}

/** Appends what the app recorded to this spec's trace file. */
const TRACE_READ_MS = 3000

export async function saveIpcTrace(app: ElectronApplication): Promise<void> {
  const directory = traceDirectory()
  if (!directory) return
  // A main process that stopped answering (the test failed mid-call) must not
  // hold up closeApp, so the read gives up after a deadline.
  const read = app
    .evaluate(() => [...((globalThis as { __ipcTrace?: Set<string> }).__ipcTrace ?? [])])
    .catch(() => [] as string[])
  const lines = await Promise.race([
    read,
    // A deadline, not a sleep: the race ends as soon as the trace is read.
    // eslint-disable-next-line no-restricted-syntax
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), TRACE_READ_MS)),
  ])
  mkdirSync(directory, { recursive: true })
  const spec = basename(test.info().file)
  appendFileSync(join(directory, `${spec}.jsonl`), lines.map((line) => `${line}\n`).join(''))
}
