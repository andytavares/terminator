import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wrapDb } from '../../../src/main/db/index'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const runOnce = vi.hoisted(() => vi.fn())
const database = vi.hoisted(() => ({ current: null as unknown }))
const sendToWindow = vi.hoisted(() => vi.fn())
const userData = vi.hoisted(() => ({ current: '' }))
const notified = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  app: { getPath: () => userData.current },
}))
vi.mock('../../../src/main/notifications/notification-manager', () => ({
  notificationManager: { create: notified },
}))
vi.mock('../../../src/main/logger', () => ({
  logger: { error: vi.fn() },
  makeLogger: () => ({ error: vi.fn() }),
}))
vi.mock('../../../src/main/safe-send', () => ({ sendToWindow }))
vi.mock('../../../src/main/db/index', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAppDb: () => database.current,
}))
vi.mock('../../../src/main/agents/acp/agent-service-instance', () => ({
  agentService: () => ({ runOnce }),
}))
vi.mock('../../../src/main/shell/login-shell-path', () => ({
  loginShellPathReady: async () => {},
}))

const call = (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)
const daily = {
  repoRoot: '/repo',
  prompt: 'Triage the inbox',
  runAs: 'agent',
  kind: 'repeat',
  repeat: { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' },
  branch: null,
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
}

const global = { ...daily, repoRoot: null, newWorktree: false }

let started: Promise<void>

beforeEach(async () => {
  vi.resetModules()
  sendToWindow.mockReset()
  notified.mockReset()
  handlers.clear()
  userData.current = mkdtempSync(join(tmpdir(), 'user-data-'))
  database.current = wrapDb(new DatabaseSync(':memory:'))
  const ipc = await import('../../../src/main/ipc/schedules.ipc')
  started = ipc.registerScheduleHandlers(() => null)
})

afterEach(async () => {
  await started
  rmSync(userData.current, { recursive: true, force: true })
})

describe('schedule channels', () => {
  it('creates, lists and deletes a schedule', async () => {
    const created = (await call('schedules:create', daily)) as { data: { id: string } }
    const listed = (await call('schedules:list')) as { data: Array<{ id: string }> }
    expect(listed.data.map((s) => s.id)).toEqual([created.data.id])
    expect(await call('schedules:delete', { id: created.data.id })).toEqual({ data: true })
    expect(await call('schedules:list')).toEqual({ data: [] })
  })

  it.each([
    ['a bad time', { ...daily, time: '9am' }],
    ['a one-time schedule with no date', { ...daily, kind: 'once' }],
    ['a daily schedule with a date', { ...daily, date: '2030-01-01' }],
    ['an empty prompt', { ...daily, prompt: '  ' }],
    ['a global run with a branch', { ...daily, repoRoot: null, newWorktree: false, branch: 'b' }],
    ['a global run on a worktree', { ...daily, repoRoot: null }],
    ['a global run in a plain terminal', { ...global, runAs: 'terminal' }],
  ])('refuses %s', async (_name, input) => {
    const reply = (await call('schedules:create', input)) as { error?: string }
    expect(reply.error).toBeDefined()
    expect(await call('schedules:list')).toEqual({ data: [] })
  })
})

describe('global scheduled runs and edits', () => {
  it('accepts a global run as an agent or as Claude in a terminal', async () => {
    for (const runAs of ['agent', 'claude-terminal'])
      expect(await call('schedules:create', { ...global, runAs })).toMatchObject({
        data: { repoRoot: null, runAs },
      })
  })

  it('edits, pauses and runs a schedule now', async () => {
    const { data } = (await call('schedules:create', daily)) as { data: { id: string } }
    expect(await call('schedules:update', { ...daily, id: data.id, time: '10:00' })).toMatchObject({
      data: { id: data.id, time: '10:00' },
    })
    expect(await call('schedules:pause', { id: data.id, paused: true })).toEqual({ data: true })
    expect(await call('schedules:list')).toMatchObject({ data: [{ paused: true }] })
    const sent = new Promise((resolve) => sendToWindow.mockImplementation(resolve))
    expect(await call('schedules:run-now', { id: data.id })).toEqual({ data: true })
    await sent
    expect(sendToWindow).toHaveBeenCalledWith(
      null,
      'schedules:run',
      expect.objectContaining({ id: data.id, unattended: expectedLaunch() })
    )
  })
})

function expectedLaunch() {
  const folder = join(userData.current, 'scheduled-runs')
  return {
    settingsPath: join(folder, 'settings.json'),
    systemPromptPath: join(folder, 'system-prompt.md'),
    systemPrompt: expect.stringContaining(join(folder, 'alerts')),
  }
}

describe('scheduled run alerts', () => {
  it('shows an alert file on Home, sends a notification, and dismisses it', async () => {
    const feed = await import('../../../src/main/home/home-feed')
    const shown = new Promise((resolve) => feed.onFeedChange(resolve))
    // Read on the watch event, or by the first scan when the watch starts after this write.
    const alerts = join(userData.current, 'scheduled-runs', 'alerts')
    mkdirSync(alerts, { recursive: true })
    writeFileSync(join(alerts, 'ci.json'), JSON.stringify({ title: 'CI red' }))
    await shown
    expect(feed.getMergedFeed().asks).toEqual([
      expect.objectContaining({ id: 'alert-ci', title: 'CI red', source: 'scheduled-alerts' }),
    ])
    expect(notified).toHaveBeenCalledWith(expect.objectContaining({ title: 'CI red' }))
    await feed.runAction('scheduled-alerts', 'alert-ci', 'dismiss')
    expect(feed.getMergedFeed().asks).toEqual([])
  })
})

describe('a refused edit', () => {
  it('refuses an edit that does not validate, and answers a failure in words', async () => {
    const { data } = (await call('schedules:create', daily)) as { data: { id: string } }
    expect(await call('schedules:update', { ...daily, id: data.id, time: '9am' })).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
    expect(await call('schedules:pause', { id: data.id })).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
    expect(await call('schedules:run-now', { id: 'gone' })).toEqual({
      error: 'failed',
      message: 'That scheduled run no longer exists.',
    })
  })

  it('home:branch-name answers the agent text, and an error on a bad payload', async () => {
    runOnce.mockResolvedValue({ text: 'feat/x', stopReason: 'end_turn', sessionId: 's' })
    expect(await call('home:branch-name', { prompt: 'do x' })).toEqual({ text: 'feat/x' })
    expect(await call('home:branch-name', { prompt: '' })).toEqual({ error: 'INVALID' })
  })
})
