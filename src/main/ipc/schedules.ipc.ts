import type { BrowserWindow } from 'electron'
import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import { logger } from '../logger.js'
import { getAppDb } from '../db/index.js'
import { agentService } from '../agents/acp/agent-service-instance.js'
import { loginShellPathReady } from '../shell/login-shell-path.js'
import { clearFeed, publishFeed, setActionHandler } from '../home/home-feed.js'
import { createBranchNamer } from '../home/branch-name.js'
import { createScheduler } from '../home/schedules.js'
import {
  BranchNameInputSchema,
  ScheduleIdInputSchema,
  ScheduleInputSchema,
  SchedulePauseInputSchema,
  ScheduleUpdateInputSchema,
} from '../../shared/schemas/schedules.schema.js'

// Core-only. Saved prompts that run later, and the branch name an agent gives a typed prompt.

const SOURCE = 'schedules'
const TICK_MS = 60_000

const failed = (error: unknown) => ({
  error: 'failed',
  message: error instanceof Error ? error.message : String(error),
})

const nameBranch = createBranchNamer({
  runOnce: (input) => agentService().runOnce(input),
  ready: loginShellPathReady,
})

type Scheduler = ReturnType<typeof createScheduler>

function scheduleChannels(scheduler: Scheduler): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'schedules:list',
      schema: noPayload,
      invalid: validationError,
      run: async () => ({ data: await scheduler.list() }),
      onError: failed,
    }),
    defineChannel({
      channel: 'schedules:create',
      schema: ScheduleInputSchema,
      invalid: validationError,
      run: async (input) => ({ data: await scheduler.create(input) }),
      onError: failed,
    }),
    defineChannel({
      channel: 'schedules:delete',
      schema: ScheduleIdInputSchema,
      invalid: validationError,
      run: async ({ id }) => {
        await scheduler.remove(id)
        return { data: true }
      },
      onError: failed,
    }),
  ]
}

/** The changes to a saved run: edit, pause or resume, and run now. */
function scheduleEditChannels(scheduler: Scheduler): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'schedules:update',
      schema: ScheduleUpdateInputSchema,
      invalid: validationError,
      run: async ({ id, ...input }) => ({ data: await scheduler.update(id, input) }),
      onError: failed,
    }),
    defineChannel({
      channel: 'schedules:pause',
      schema: SchedulePauseInputSchema,
      invalid: validationError,
      run: ({ id, paused }) => scheduler.setPaused(id, paused).then(() => ({ data: true })),
      onError: failed,
    }),
    defineChannel({
      channel: 'schedules:run-now',
      schema: ScheduleIdInputSchema,
      invalid: validationError,
      run: async ({ id }) => {
        await scheduler.runNow(id)
        return { data: true }
      },
      onError: failed,
    }),
  ]
}

const branchNameChannel = defineChannel({
  channel: 'home:branch-name',
  schema: BranchNameInputSchema,
  invalid: () => ({ error: 'INVALID' }),
  run: ({ prompt }) => nameBranch(prompt),
  onError: () => ({ error: 'FAILED' }),
})

/** Opens the table, raises what was missed while closed, then checks once a minute. */
export function registerScheduleHandlers(getWindow: () => BrowserWindow | null): void {
  const scheduler = createScheduler({
    db: getAppDb(),
    now: () => new Date(),
    // The renderer launches it, through the same path Start work uses.
    start: (schedule) => sendToWindow(getWindow(), 'schedules:run', schedule),
    publish: (asks) =>
      asks.length === 0
        ? clearFeed(SOURCE)
        : publishFeed(SOURCE, { asks, facets: [], measures: [] }),
  })
  setActionHandler(SOURCE, (askId, actionId) => scheduler.act(askId, actionId))
  registerInvokeTable([
    ...scheduleChannels(scheduler),
    ...scheduleEditChannels(scheduler),
    branchNameChannel,
  ])
  const tick = (check: () => Promise<void>) => () =>
    void check().catch((error) => logger.error('schedule check failed', { error: String(error) }))
  void scheduler
    .init()
    .then(tick(scheduler.checkMissed))
    .then(() => setInterval(tick(scheduler.tick), TICK_MS).unref())
    .catch((error) => logger.error('schedules could not start', { error: String(error) }))
}
