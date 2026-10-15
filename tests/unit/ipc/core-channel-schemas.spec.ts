import { describe, it, expect, vi } from 'vitest'
import type { ChannelSpec } from '@terminator/extension-sdk'

// ADR 096: every core invoke channel is registered through the schema table.
// This registers every core handler with its dependencies stubbed, then walks
// the channel registry the remote bridge dispatches through.

const { stubModule } = vi.hoisted(() => ({
  // Any named import resolves to a stub function, so a handler module loads
  // without the stores, services and Electron objects behind it.
  stubModule: () => {
    const exports: Record<string | symbol, unknown> = {}
    return new Proxy(exports, {
      get: (target, key) => {
        if (key === 'then' || typeof key === 'symbol') return undefined
        return (target[key] ??= vi.fn())
      },
    })
  },
}))

// The schema table's rows, as each handler module hands them to registerInvokeTable.
const { tableRows } = vi.hoisted(() => ({ tableRows: new Map<string, ChannelSpec>() }))
vi.mock('../../../src/main/ipc/invoke-table.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/ipc/invoke-table.js')>()
  return {
    ...actual,
    registerInvokeTable: (specs: ReadonlyArray<ChannelSpec>) => {
      for (const spec of specs) tableRows.set(spec.channel, spec)
      actual.registerInvokeTable(specs)
    },
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getName: vi.fn(), getVersion: vi.fn(), getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
}))

vi.mock('../../../src/main/storage/workspace-store', () => stubModule())
vi.mock('../../../src/main/storage/settings-store', () => stubModule())
vi.mock('../../../src/main/storage/extension-settings-store', () => stubModule())
vi.mock('../../../src/main/git/git-service', () => stubModule())
vi.mock('../../../src/main/git/branch-exclude', () => stubModule())
vi.mock('../../../src/main/git/branch-exclude-settings', () => stubModule())
vi.mock('../../../src/main/extensions/workspace-events', () => stubModule())
vi.mock('../../../src/main/extensions/api', () => stubModule())
vi.mock('../../../src/main/integrations/issue-link-store', () => stubModule())
vi.mock('../../../src/main/integrations/agent-context', () => stubModule())
vi.mock('../../../src/main/integrations/index', () => stubModule())
vi.mock('../../../src/main/integrations/providers/jira.provider', () => stubModule())
vi.mock('../../../src/main/integrations/providers/linear.provider', () => stubModule())
vi.mock('../../../src/main/integrations/tracker-store', () => stubModule())
vi.mock('../../../src/main/integrations/tracker-error', () => stubModule())
vi.mock('../../../src/main/integrations/context-sync', () => stubModule())
vi.mock('../../../src/main/integrations/session-context', () => stubModule())
vi.mock('../../../src/main/notifications/notification-manager', () => stubModule())
vi.mock('../../../src/main/sessions/session-record-store', () => stubModule())
vi.mock('../../../src/main/terminal/pty-manager', () => stubModule())
vi.mock('../../../src/main/safe-send', () => stubModule())
vi.mock('../../../src/main/fs/fs-watcher', () => stubModule())
vi.mock('../../../src/main/shell/shell-executor', () => stubModule())
vi.mock('../../../src/main/editor/open-in-editor', () => stubModule())
vi.mock('../../../src/main/db/index', () => stubModule())

import { ipcInvokeRegistry } from '../../../src/main/remote/ipc-registry.js'
import { ELECTRON_API_MANIFEST } from '../../../src/shared/electron-api/manifest.js'
import { registerAppInfoHandlers, registerDialogHandlers } from '../../../src/main/ipc/app.ipc.js'
import { registerDbIpcHandlers } from '../../../src/main/ipc/db.ipc.js'
import { registerEditorHandlers } from '../../../src/main/ipc/editor.ipc.js'
import { registerExtensionHandlers } from '../../../src/main/ipc/extension.ipc.js'
import { registerFsHandlers } from '../../../src/main/ipc/fs.ipc.js'
import { registerGitHandlers } from '../../../src/main/ipc/git.ipc.js'
import { registerIntegrationsHandlers } from '../../../src/main/ipc/integrations.ipc.js'
import { registerMetricsHandlers } from '../../../src/main/ipc/metrics.ipc.js'
import { registerNotificationHandlers } from '../../../src/main/ipc/notification.ipc.js'
import { registerSessionRecordsHandlers } from '../../../src/main/ipc/session-records.ipc.js'
import { registerSettingsHandlers } from '../../../src/main/ipc/settings.ipc.js'
import { registerShellHandlers } from '../../../src/main/ipc/shell.ipc.js'
import { registerTerminalHandlers } from '../../../src/main/ipc/terminal.ipc.js'
import { registerWorkspaceHandlers } from '../../../src/main/ipc/workspace.ipc.js'
import type { ExtensionHost } from '../../../src/main/extensions/extension-host.js'
import type { PtyManager } from '../../../src/main/terminal/pty-manager.js'
import type { OutputRelay } from '../../../src/main/terminal/output-relay.js'
import { partialFake } from '../../support/fakes'

function registerEveryCoreHandler(): void {
  vi.useFakeTimers()
  const noWindow = () => null
  registerAppInfoHandlers()
  registerDialogHandlers(noWindow)
  registerDbIpcHandlers()
  registerEditorHandlers()
  registerExtensionHandlers(partialFake<ExtensionHost>({}), vi.fn())
  registerFsHandlers()
  registerGitHandlers()
  registerIntegrationsHandlers(noWindow)
  registerMetricsHandlers(partialFake<PtyManager>({}))
  registerNotificationHandlers()
  registerSessionRecordsHandlers(noWindow)
  registerSettingsHandlers()
  registerShellHandlers()
  registerTerminalHandlers(partialFake<PtyManager>({}), noWindow, partialFake<OutputRelay>({}))
  registerWorkspaceHandlers()
}
registerEveryCoreHandler()

const WRONG_TYPE_PAYLOAD = 42

describe('core invoke channels', () => {
  it('registers every invoke channel the manifest exposes remotely', () => {
    const exposed = ELECTRON_API_MANIFEST.filter(
      (spec) => spec.kind === 'invoke' && (spec.remote ?? 'same') === 'same'
    ).map((spec) => spec.channel!)

    const unregistered = exposed.filter((channel) => !ipcInvokeRegistry.has(channel))

    expect(unregistered).toEqual([])
  })

  it('has registered channels to check', () => {
    expect(ipcInvokeRegistry.size).toBeGreaterThan(0)
  })

  describe.each([...ipcInvokeRegistry.keys()])('%s', (channel) => {
    it('was registered through the schema table', () => {
      expect(tableRows.get(channel)?.schema).toBeDefined()
    })

    it('answers a payload of the wrong type with its invalid response, without running', async () => {
      const spec = tableRows.get(channel)!
      const run = vi.spyOn(spec, 'run')
      const parsed = spec.schema.safeParse(WRONG_TYPE_PAYLOAD)
      const expected =
        typeof spec.invalid === 'function'
          ? (spec.invalid as (error: unknown) => unknown)(parsed.success ? null : parsed.error)
          : spec.invalid

      const reply = await ipcInvokeRegistry.get(channel)!.handler(null as never, WRONG_TYPE_PAYLOAD)

      expect(parsed.success).toBe(false)
      expect(reply).toEqual(expected)
      expect(run).not.toHaveBeenCalled()
    })
  })
})
