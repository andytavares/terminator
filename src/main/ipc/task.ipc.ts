import type { BrowserWindow } from 'electron'
import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { failureOf, registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import {
  TaskArchiveInputSchema,
  TaskCreateInputSchema,
  TaskLaneInputSchema,
  TaskUpdateInputSchema,
} from '../../shared/schemas/tasks.schema.js'
import {
  addLane,
  archiveTask,
  createTask,
  listTasks,
  onTaskChange,
  removeLane,
  updateTask,
} from '../tasks/task-store.js'

// Core-only. Tasks are the operator's own grouping; no extension reads them.

const taskChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'task:list',
    schema: noPayload,
    invalid: validationError,
    run: () => ({ data: listTasks() }),
  }),
  defineChannel({
    channel: 'task:create',
    schema: TaskCreateInputSchema,
    invalid: validationError,
    run: async (input) => ({ data: await createTask(input) }),
    onError: failureOf,
  }),
  defineChannel({
    channel: 'task:update',
    schema: TaskUpdateInputSchema,
    invalid: validationError,
    run: async (input) => ({ data: await updateTask(input) }),
    onError: failureOf,
  }),
  defineChannel({
    channel: 'task:add-lane',
    schema: TaskLaneInputSchema,
    invalid: validationError,
    run: async ({ id, lane }) => ({ data: await addLane(id, lane) }),
    onError: failureOf,
  }),
  defineChannel({
    channel: 'task:remove-lane',
    schema: TaskLaneInputSchema,
    invalid: validationError,
    run: async ({ id, lane }) => ({ data: await removeLane(id, lane) }),
    onError: failureOf,
  }),
  defineChannel({
    channel: 'task:archive',
    schema: TaskArchiveInputSchema,
    invalid: validationError,
    run: async ({ id, archived }) => ({ data: await archiveTask(id, archived) }),
    onError: failureOf,
  }),
]

export function registerTaskHandlers(getWindow: () => BrowserWindow | null): void {
  registerInvokeTable(taskChannels)

  onTaskChange((tasks) => {
    sendToWindow(getWindow(), 'task:changed', tasks)
  })
}
