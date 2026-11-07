import * as path from 'node:path'
import { app, type BrowserWindow } from 'electron'
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
import { alertsFolder, writeUnattendedFiles } from '../home/unattended-run.js'
import { createAlerts, watchAlerts } from '../home/scheduled-alerts.js'
import { notificationManager } from '../notifications/notification-manager.js'
import {
  BranchNameInputSchema,
  ScheduleIdInputSchema,
  ScheduleInputSchema,
  SchedulePauseInputSchema,
  ScheduleUpdateInputSchema,
} from '../../shared/schemas/schedules.schema.js'
import type { HomeAsk } from '../../shared/schemas/home-feed.schema.js'

// Core-only. Saved prompts that run later, and the branch name an agent gives a typed prompt.

const SOURCE = 'schedules'
const ALERTS_SOURCE = 'scheduled-alerts'
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
      run: ({ id, paused }) => scheduler.pauseRun(id, paused).then(() => ({ data: true })),
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

const publisherFor = (source: string) => (asks: HomeAsk[]) =>
  asks.length === 0 ? clearFeed(source) : publishFeed(source, { asks, facets: [], measures: [] })

/** Shows what a scheduled run's agent writes into the alerts folder, on Home and as notifications. */
function startAlerts(folder: string): void {
  const alerts = createAlerts({
    now: () => new Date(),
    notify: (title, message) =>
      void notificationManager.create({ type: 'info', title, message, key: 'scheduledRunAlert' }),
    publish: publisherFor(ALERTS_SOURCE),
  })
  setActionHandler(ALERTS_SOURCE, async (askId, actionId) => alerts.act(askId, actionId))
  watchAlerts(alertsFolder(folder), alerts.receive)
}

/** Opens the table, raises what was missed while closed, then checks once a minute.
 * Resolves once the scheduled-run files are written and alerts are watched. */
export function registerScheduleHandlers(getWindow: () => BrowserWindow | null): Promise<void> {
  const folder = path.join(app.getPath('userData'), 'scheduled-runs')
  const launch = writeUnattendedFiles(folder)
  const scheduler = createScheduler({
    db: getAppDb(),
    now: () => new Date(),
    // The renderer launches it, through the same path Start work uses.
    start: (schedule) =>
      void launch.then((unattended) =>
        sendToWindow(getWindow(), 'schedules:run', { ...schedule, unattended })
      ),
    publish: publisherFor(SOURCE),
  })
  setActionHandler(SOURCE, (askId, actionId) => scheduler.act(askId, actionId))
  registerInvokeTable([
    ...scheduleChannels(scheduler),
    ...scheduleEditChannels(scheduler),
    branchNameChannel,
  ])
  startTicks(scheduler)
  return launch
    .then(() => startAlerts(folder))
    .catch((error) => logger.error('scheduled run files not written', { error: String(error) }))
}

function startTicks(scheduler: Scheduler): void {
  const tick = (check: () => Promise<void>) => () =>
    void check().catch((error) => logger.error('schedule check failed', { error: String(error) }))
  void scheduler
    .init()
    .then(tick(scheduler.checkMissed))
    .then(() => setInterval(tick(scheduler.tick), TICK_MS).unref())
    .catch((error) => logger.error('schedules could not start', { error: String(error) }))
}
