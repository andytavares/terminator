import { describe, it, expect, vi } from 'vitest'
import type { ChannelSpec, ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'

vi.mock('electron', () => ({
  dialog: {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { registerAdminIpcHandlers } from '../../src/ipc/admin.ipc.js'
import { registerKanbanIpcHandlers } from '../../src/ipc/kanban.ipc.js'
import { registerLinksIpcHandlers } from '../../src/ipc/links.ipc.js'
import { registerProjectsIpcHandlers } from '../../src/ipc/projects.ipc.js'
import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc.js'
import { registerWeeklyReviewIpcHandlers } from '../../src/ipc/weekly-review.ipc.js'

function registerEverything(): Map<string, boolean> {
  const remoteByChannel = new Map<string, boolean>()
  const api = {
    ipc: {
      registerHandler: (spec: ChannelSpec, opts?: { remoteAccessible?: boolean }) => {
        remoteByChannel.set(spec.channel, opts?.remoteAccessible === true)
        return { dispose: () => {} }
      },
    },
  } as unknown as ExtensionAPI
  const db = {} as ExtensionDB
  for (const register of [
    registerAdminIpcHandlers,
    registerKanbanIpcHandlers,
    registerLinksIpcHandlers,
    registerProjectsIpcHandlers,
    registerVaultIpcHandlers,
    registerWeeklyReviewIpcHandlers,
  ]) {
    register(api, db)
  }
  return remoteByChannel
}

describe('task-vault remote access', () => {
  it('keeps the SQL console, table inspection and bulk or file channels local to the desktop', () => {
    const channels = registerEverything()
    const local = [...channels].filter(([, remote]) => !remote).map(([channel]) => channel)

    expect(local.sort()).toEqual([
      'task-vault:admin:list-tables',
      'task-vault:admin:run-query',
      'task-vault:admin:table-stats',
      'task-vault:review:export',
      'task-vault:vault:export-json',
      'task-vault:vault:import-json',
    ])
  })

  it('lets the remote browser use the task views', () => {
    const channels = registerEverything()

    for (const channel of [
      'task-vault:vault:get-today',
      'task-vault:vault:add-task',
      'task-vault:kanban:list-tasks',
      'task-vault:projects:list',
      'task-vault:links:create',
      'task-vault:review:start',
    ]) {
      expect(channels.get(channel), channel).toBe(true)
    }
  })
})
