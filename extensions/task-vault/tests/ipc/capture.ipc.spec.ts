import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { createIpcHarness, createVaultDb, selectTaskRow } from '../support/vault-db'

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

const captureVia = (payload: unknown) => harness.invoke('task-vault:vault:capture', payload)

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
    const { taskId } = (await captureVia({ text: 'New task' })) as { taskId: string }

    expect(await selectTaskRow(db, taskId)).toMatchObject({
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
  describe('found by vault:query', taskVaultVaultCaptureIPCTagsFoundByQueryTests)
}

function taskVaultVaultCaptureIPCTagsCreatesTheProjectTests() {
  it('creates the project and area named by inline tags and links the task to them', async () => {
    const { taskId } = (await captureVia({
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
    await captureVia({ text: 'First @website' })
    await captureVia({ text: 'Second @website' })

    expect(await db.query('SELECT id FROM projects')).toHaveLength(1)
    expect(await db.query('SELECT id FROM tasks WHERE project_id IS NOT NULL')).toHaveLength(2)
  })
}

function taskVaultVaultCaptureIPCTagsFoundByQueryTests() {
  it('files captured tasks where vault:query finds them by each tag in display form', async () => {
    for (const text of [
      'Buy paint +errands #home due:2031-01-10',
      'Call the council +phone #home due:2031-03-01',
      'Email the editor +computer',
    ]) {
      await captureVia({ text })
    }
    const textsFound = async (filter: Record<string, unknown>) =>
      (
        (await harness.invoke('task-vault:vault:query', filter)) as { tasks: { text: string }[] }
      ).tasks.map((task) => task.text)

    expect(await textsFound({ context: 'Errands' })).toEqual(['Buy paint'])
    expect(await textsFound({ area: 'Home' })).toEqual(['Buy paint', 'Call the council'])
    expect(await textsFound({ area: 'Home', dueBefore: '2031-02-01' })).toEqual(['Buy paint'])
    expect(await textsFound({ status: ['open'], context: 'Computer' })).toEqual([
      'Email the editor',
    ])
  })
}

function taskVaultVaultCaptureIPCHintsErrorsTests() {
  it('applies the project and area hints as tags', async () => {
    const { taskId } = (await captureVia({
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
    expect(await captureVia({ text: 'Doomed' })).toMatchObject({ error: expect.any(String) })
  })
}
