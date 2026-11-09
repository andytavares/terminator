import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { registerAdminIpcHandlers } from '../../src/ipc/admin.ipc.js'
import { registerLinksIpcHandlers } from '../../src/ipc/links.ipc.js'
import { registerProjectsIpcHandlers } from '../../src/ipc/projects.ipc.js'
import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc.js'
import { remoteAccessByChannel } from '../../../../packages/test-support/src/extension-channels'

const REGISTRARS = [
  registerAdminIpcHandlers,
  registerLinksIpcHandlers,
  registerProjectsIpcHandlers,
  registerVaultIpcHandlers,
]

describe('task-vault remote access', () => {
  it('keeps the SQL console, table inspection and bulk or file channels local to the desktop', () => {
    const channels = remoteAccessByChannel(REGISTRARS)
    const local = [...channels].filter(([, remote]) => !remote).map(([channel]) => channel)

    expect(local.sort()).toEqual([
      'task-vault:admin:run-query',
      'task-vault:admin:table-stats',
      'task-vault:vault:export-json',
      'task-vault:vault:import-json',
    ])
  })

  it.each([
    'task-vault:vault:get-today',
    'task-vault:vault:add-task',
    'task-vault:vault:list-contexts',
    'task-vault:projects:list',
    'task-vault:links:create',
  ])('lets the remote browser use %s', (channel) => {
    expect(remoteAccessByChannel(REGISTRARS).get(channel)).toBe(true)
  })
})
