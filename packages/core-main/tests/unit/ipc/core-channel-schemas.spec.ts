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
vi.mock('../../../src/ipc/invoke-table.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ipc/invoke-table.js')>()
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

vi.mock('../../../src/storage/workspace-store', () => stubModule())
vi.mock('../../../src/storage/settings-store', () => stubModule())
vi.mock('../../../src/storage/extension-settings-store', () => stubModule())
vi.mock('../../../src/git/git-service', () => stubModule())
vi.mock('../../../src/git/branch-exclude', () => stubModule())
vi.mock('../../../src/git/branch-exclude-settings', () => stubModule())
vi.mock('../../../src/extensions/workspace-events', () => stubModule())
vi.mock('../../../src/extensions/api', () => stubModule())
vi.mock('../../../src/integrations/issue-link-store', () => stubModule())
vi.mock('../../../src/integrations/agent-context', () => stubModule())
vi.mock('../../../src/integrations/index', () => stubModule())
vi.mock('../../../src/integrations/providers/linear.provider', () => stubModule())
vi.mock('../../../src/integrations/tracker-store', () => stubModule())
vi.mock('../../../src/integrations/tracker-error', () => stubModule())
vi.mock('../../../src/integrations/context-sync', () => stubModule())
vi.mock('../../../src/integrations/session-context', () => stubModule())
vi.mock('../../../src/notifications/notification-manager', () => stubModule())
vi.mock('../../../src/sessions/session-record-store', () => stubModule())
vi.mock('../../../src/terminal/pty-manager', () => stubModule())
vi.mock('../../../src/safe-send', () => stubModule())
vi.mock('../../../src/fs/fs-watcher', () => stubModule())
vi.mock('../../../src/shell/shell-executor', () => stubModule())
vi.mock('../../../src/editor/open-in-editor', () => stubModule())
vi.mock('../../../src/db/index', () => stubModule())

import { ipcInvokeRegistry } from '../../../src/remote/ipc-registry.js'
import { ELECTRON_API_MANIFEST } from '../../../../core-shared/src/electron-api/manifest.js'
import { registerAppInfoHandlers, registerDialogHandlers } from '../../../src/ipc/app.ipc.js'
import { registerDbIpcHandlers } from '../../../src/ipc/db.ipc.js'
import { registerEditorHandlers } from '../../../src/ipc/editor.ipc.js'
import { registerBugReportHandlers, type BugReportDeps } from '../../../src/ipc/bug-report.ipc.js'
import { registerExtensionHandlers } from '../../../src/ipc/extension.ipc.js'
import { registerFsHandlers } from '../../../src/ipc/fs.ipc.js'
import { registerGitHandlers } from '../../../src/ipc/git.ipc.js'
import { registerIntegrationsHandlers } from '../../../src/ipc/integrations.ipc.js'
import { registerMetricsHandlers } from '../../../src/ipc/metrics.ipc.js'
import { registerNotificationHandlers } from '../../../src/ipc/notification.ipc.js'
import { registerSessionRecordsHandlers } from '../../../src/ipc/session-records.ipc.js'
import { registerSettingsHandlers } from '../../../src/ipc/settings.ipc.js'
import { registerShellHandlers } from '../../../src/ipc/shell.ipc.js'
import { registerTaskHandlers } from '../../../src/ipc/task.ipc.js'
import { registerTerminalHandlers } from '../../../src/ipc/terminal.ipc.js'
import { registerWorkspaceHandlers } from '../../../src/ipc/workspace.ipc.js'
import type { ExtensionHost } from '../../../src/extensions/extension-host.js'
import type { PtyManager } from '../../../src/terminal/pty-manager.js'
import type { OutputRelay } from '../../../src/terminal/output-relay.js'
import { partialFake } from '../../../../test-support/src/fakes'

function registerEveryCoreHandler(): void {
  vi.useFakeTimers()
  const noWindow = () => null
  registerAppInfoHandlers()
  registerDialogHandlers(noWindow)
  registerDbIpcHandlers()
  registerEditorHandlers()
  registerBugReportHandlers(partialFake<BugReportDeps>({}))
  registerExtensionHandlers(partialFake<ExtensionHost>({}), vi.fn())
  registerFsHandlers()
  registerGitHandlers()
  registerIntegrationsHandlers(noWindow)
  registerMetricsHandlers(partialFake<PtyManager>({}))
  registerNotificationHandlers()
  registerSessionRecordsHandlers(noWindow)
  registerSettingsHandlers()
  registerShellHandlers()
  registerTaskHandlers(noWindow)
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
