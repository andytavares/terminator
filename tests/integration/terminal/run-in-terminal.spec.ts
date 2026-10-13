import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { hostSnapshot } from '../../support/host-snapshot'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { rmSync } from 'node:fs'
import { makeTempDir } from '../../support/temp-dir'

// A real PTY, end to end: node-pty runs the program, the core's terminal API
// reports how it ended, and the answer crosses the extension host's port the
// way Foundry's verification commands receive it. Nothing here is typed into
// a shell, and no status is read back from output or a file.

// Read when the registry is written, by which time this has run.
const userData = makeTempDir('run-in-terminal-')

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '0.1.0' },
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn(() => false) },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
}))
vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))
vi.mock('../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: () => ({ terminal: { defaultShell: '/bin/sh', scrollbackLimit: 5000 } }),
  getWorkspaceSettings: () => ({}),
}))

import { PtyManager } from '../../../src/main/terminal/pty-manager'
import { createExtensionAPI } from '../../../src/main/extensions/api'
import { RpcEndpoint, type MessageLink } from '../../../src/main/extensions/host/rpc-endpoint'
import { ExtensionApiServer } from '../../../src/main/extensions/host/api-server'
import { createHostExtensionAPI } from '../../../src/main/extensions/host/host-api'
import { CallbackRegistry } from '../../../src/main/extensions/host/callbacks'
import type { ExtensionAPI } from '@terminator/extension-sdk'

const ports: MessagePort[] = []
let ptyManager: PtyManager
/** What the renderer is told to do once a tab is adopted, standing in for a person. */
let onAdopt: (sessionId: string) => void

function link(port: MessagePort): MessageLink {
  ports.push(port)
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => port.on('message', receive),
  }
}

/** The renderer's part: adopt a tab, and close it (ending its process) when asked. */
function renderer(channel: string, data: unknown): void {
  const { sessionId } = data as { sessionId: string }
  if (channel === 'terminal:adopt') onAdopt(sessionId)
  if (channel === 'terminal:close-tab') ptyManager.kill(sessionId)
}

/** The API as an extension backend in the extension host holds it. */
function hostApi(): ExtensionAPI {
  const coreApi = createExtensionAPI('test.runner', '0.1.0', {
    ptyManager,
    terminalRelay: { start: () => {} } as never,
    broadcastToWindows: renderer,
  })
  const { port1, port2 } = new MessageChannel()
  const main = new RpcEndpoint(link(port1))
  new ExtensionApiServer(main, () => coreApi)
  return createHostExtensionAPI({
    extensionId: 'test.runner',
    endpoint: new RpcEndpoint(link(port2)),
    snapshot: hostSnapshot(),
    db: {} as never,
    callbacks: new CallbackRegistry(),
    channels: new Map(),
    commands: new Map(),
    exportsOf: () => undefined,
    report: () => {},
  })
}

function run(api: ExtensionAPI, script: string) {
  return api.pty.runInTerminal({
    projectId: 'proj-1',
    cwd: userData,
    tabTitle: 'Check',
    file: '/bin/sh',
    args: ['-c', script],
  })
}

beforeEach(() => {
  ptyManager = new PtyManager()
  onAdopt = () => {}
})

afterEach(async () => {
  await ptyManager.killAll()
  for (const port of ports.splice(0)) port.close()
})

describe('pty.runInTerminal, over a real PTY and the extension host port', () => {
  it('resolves 0 for a command that exits 0', async () => {
    await expect(run(hostApi(), 'exit 0')).resolves.toEqual({
      sessionId: expect.any(String),
      exitCode: 0,
    })
  })

  it("resolves a non-zero exit with the process's own status", async () => {
    await expect(run(hostApi(), 'echo failing; exit 3')).resolves.toMatchObject({ exitCode: 3 })
  })

  // node-pty reports a signalled process as exitCode 0 with the signal beside
  // it (WIFSIGNALED in src/unix/pty.cc); read on its own, that is a pass.
  it('resolves null, never 0, for a process killed by a signal', async () => {
    await expect(run(hostApi(), 'kill -9 $$')).resolves.toMatchObject({ exitCode: null })
  })

  it('resolves null when the tab is closed before the process exits', async () => {
    const api = hostApi()
    onAdopt = (sessionId) => setTimeout(() => api.pty.closeTerminalTab(sessionId), 200)
    await expect(run(api, 'sleep 30; exit 0')).resolves.toMatchObject({ exitCode: null })
  })

  it('resolves null, opening nothing, when there is no window to show the tab in', async () => {
    const api = createExtensionAPI('test.runner', '0.1.0', { ptyManager })
    await expect(run(api, 'exit 0')).resolves.toBeNull()
    expect(ptyManager.listSessions()).toEqual([])
  })
})

describe('PtyManager exit status, over a real PTY', () => {
  function exitOf(script: string): Promise<number | null> {
    ptyManager.spawnSession({
      sessionId: 'exit-probe',
      cwd: userData,
      shell: '/bin/sh',
      args: ['-c', script],
      type: 'human',
      origin: 'app',
    })
    return new Promise((resolve) => ptyManager.onExit('exit-probe', resolve))
  }

  it('reports the exit code of a process that exited', async () => {
    await expect(exitOf('exit 7')).resolves.toBe(7)
  })

  it('reports null, not 0, for a shell killed while it was still running', async () => {
    ptyManager.spawnSession({
      sessionId: 'killed',
      cwd: userData,
      shell: '/bin/sh',
      type: 'human',
      origin: 'app',
    })
    const exit = new Promise((resolve) => ptyManager.onExit('killed', resolve))
    ptyManager.kill('killed')
    await expect(exit).resolves.toBeNull()
  })

  it('reports null for a process ended by a signal', async () => {
    await expect(exitOf('kill -TERM $$')).resolves.toBeNull()
  })
})

afterAll(() => rmSync(userData, { recursive: true, force: true }))
