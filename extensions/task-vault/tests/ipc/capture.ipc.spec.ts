import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { createIpcHarness, createVaultDb, taskRow } from '../support/vault-db'

vi.mock('../../src/notifications/task-scheduler.js', () => ({
  triggerSchedulerTick: vi.fn(),
  broadcast: vi.fn(),
}))

import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerVaultIpcHandlers(harness.api, db)
})

const capture = (payload: unknown) => harness.invoke('task-vault:vault:capture', payload)

describe('task-vault:vault:capture IPC handler', taskVaultVaultCaptureIPCTests)

function taskVaultVaultCaptureIPCTests() {
  describe('storing', taskVaultVaultCaptureIPCStoringTests)
  describe('tags', taskVaultVaultCaptureIPCTagsTests)
  describe('hints and errors', taskVaultVaultCaptureIPCHintsErrorsTests)
}

function taskVaultVaultCaptureIPCStoringTests() {
  it('registers the capture handler', () => {
    expect(harness.channels()).toContain('task-vault:vault:capture')
  })

  it('stores an open inbox task and returns its id', async () => {
    const { taskId } = (await capture({ text: 'New task' })) as { taskId: string }

    expect(await taskRow(db, taskId)).toMatchObject({
      text: 'New task',
      status: 'open',
      source: 'inbox',
      project_id: null,
      area_id: null,
    })
  })
}

function taskVaultVaultCaptureIPCTagsTests() {
  describe('creates the project', taskVaultVaultCaptureIPCTagsCreatesTheProjectTests)
  describe('reuses an existing', taskVaultVaultCaptureIPCTagsReusesAnExistingTests)
}

function taskVaultVaultCaptureIPCTagsCreatesTheProjectTests() {
  it('creates the project and area named by inline tags and links the task to them', async () => {
    const { taskId } = (await capture({
      text: 'Plan launch @website #work +computer due:2026-03-01',
    })) as {
      taskId: string
    }

    const row = await db.get<Record<string, unknown>>(
      `SELECT t.text, t.context, t.due_date, p.name AS project, a.name AS area
       FROM tasks t JOIN projects p ON p.id = t.project_id JOIN areas a ON a.id = t.area_id
       WHERE t.id = ?`,
      [taskId]
    )
    expect(row).toMatchObject({
      text: 'Plan launch',
      context: 'Computer',
      due_date: '2026-03-01',
      project: 'Website',
      area: 'Work',
    })
  })
}

function taskVaultVaultCaptureIPCTagsReusesAnExistingTests() {
  it('reuses an existing project instead of creating a second one', async () => {
    await capture({ text: 'First @website' })
    await capture({ text: 'Second @website' })

    expect(await db.query('SELECT id FROM projects')).toHaveLength(1)
    expect(await db.query('SELECT id FROM tasks WHERE project_id IS NOT NULL')).toHaveLength(2)
  })
}

function taskVaultVaultCaptureIPCHintsErrorsTests() {
  it('applies the project and area hints as tags', async () => {
    const { taskId } = (await capture({
      text: 'Call',
      hintProject: 'alpha',
      hintArea: 'home',
    })) as {
      taskId: string
    }

    const row = await db.get<Record<string, unknown>>(
      `SELECT p.name AS project, a.name AS area FROM tasks t
       JOIN projects p ON p.id = t.project_id JOIN areas a ON a.id = t.area_id WHERE t.id = ?`,
      [taskId]
    )
    expect(row).toMatchObject({ project: 'Alpha', area: 'Home' })
  })

  it('returns { error } instead of throwing when the database fails', async () => {
    await db.exec('DROP TABLE tasks')
    expect(await capture({ text: 'Doomed' })).toMatchObject({ error: expect.any(String) })
  })
}
