import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  e2eTempDir,
  runQuickActionFromPanel,
} from '../helpers'
import type { AppHandle } from '../helpers'
import { openHome } from '../session-views'

// Retakes the user-guide screenshots of Home's Scheduled view and of Start work with Global chosen.
// Writes into docs/, so run it on purpose, after `npm run build`:
//   E2E_TOOLS=1 npx playwright test tests/e2e/tools/capture-scheduled-runs-screenshots.spec.ts

let handle: AppHandle | undefined
const DOCS = 'docs/user-guide/screenshots'

test.afterAll(async () => closeApp(handle))

/** A repository with one commit, so the workspace reports a branch. */
function gitFolder(): string {
  const folder = e2eTempDir('scheduled-shots-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  git('init', '-q')
  git(
    '-c',
    'user.name=Demo',
    '-c',
    'user.email=demo@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Start'
  )
  return folder
}

const DAILY = { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' } as const
const WEEKDAYS = { ...DAILY, days: [1, 2, 3, 4, 5] }
const HALF_HOURLY = { ...DAILY, every: 30, unit: 'minute', between: { from: '09:00', to: '18:00' } }
const WEEKLY = { ...DAILY, unit: 'week', days: [1] }

const REPEAT = {
  branch: null,
  newWorktree: false,
  agentId: null,
  date: null,
  runAs: 'agent',
  kind: 'repeat',
}
const GLOBAL_RUN = {
  ...REPEAT,
  repoRoot: null,
  prompt: 'Summarise yesterday’s merged pull requests',
  time: '08:30',
  repeat: WEEKDAYS,
}

/** One global run, two runs in api-gateway (the second is paused) and a one-time run in web-console. */
function seededRuns(apiGateway: string, webConsole: string) {
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE')
  return [
    GLOBAL_RUN,
    {
      ...REPEAT,
      repoRoot: apiGateway,
      prompt: 'Triage new Sentry errors',
      time: '09:00',
      repeat: HALF_HOURLY,
    },
    {
      ...REPEAT,
      repoRoot: apiGateway,
      prompt: 'Bump patch dependencies',
      runAs: 'claude-terminal',
      time: '07:00',
      repeat: WEEKLY,
    },
    {
      ...REPEAT,
      repoRoot: webConsole,
      prompt: 'Check the release notes draft',
      kind: 'once',
      time: '10:00',
      date: tomorrow,
      repeat: null,
    },
  ]
}

async function seedRuns(page: Page, apiGateway: string, webConsole: string): Promise<void> {
  const ids = await page.evaluate(
    async (inputs) => {
      const created: string[] = []
      for (const input of inputs) {
        const result = await window.electronAPI.schedules.create(input as never)
        if (!('data' in result)) throw new Error(result.message)
        created.push(result.data.id)
      }
      return created
    },
    seededRuns(apiGateway, webConsole)
  )
  await page.evaluate((id) => window.electronAPI.schedules.pause({ id, paused: true }), ids[2])
}

async function startWorkWithGlobalRepeat(page: Page): Promise<void> {
  await page
    .getByRole('radio', { name: 'Desk' })
    .or(page.getByRole('radio', { name: 'Today' }))
    .click()
  await page.getByRole('button', { name: /^Start work/ }).click()
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  await launcher.getByLabel('What should it do?').fill('Summarise yesterday’s merged pull requests')
  await launcher.getByRole('button', { name: /^Workspace:/ }).click()
  await page
    .getByRole('listbox', { name: 'Workspace' })
    .getByRole('option', { name: /^Global/ })
    .click()
  await expect(launcher.getByRole('button', { name: 'Workspace: Global' })).toBeVisible()
  await launcher.getByRole('radio', { name: 'Repeat' }).click()
  await launcher.getByRole('button', { name: 'Weekdays 09:00' }).click()
}

test('capture Home Scheduled and Start work with Global', async () => {
  handle = await launchApp(undefined, {}, { hideSidebarOnHome: true })
  const { page } = handle
  await page.setViewportSize({ width: 1440, height: 900 })
  await runQuickActionFromPanel(page, 'Toggle sidebar')
  const apiGateway = gitFolder()
  const webConsole = gitFolder()
  await createWorkspace(page, 'api-gateway', apiGateway)
  await createWorkspace(page, 'web-console', webConsole)
  await seedRuns(page, apiGateway, webConsole)

  await openHome(page)
  await page.getByRole('radio', { name: 'Scheduled' }).click()
  const table = page.getByRole('table', { name: 'Scheduled runs' })
  await expect(table).toContainText('Check the release notes draft')
  await expect(table).toContainText('Paused')
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.screenshot({ path: join(DOCS, '11d-home-scheduled.png') })

  await startWorkWithGlobalRepeat(page)
  await page.screenshot({ path: join(DOCS, '11e-start-work-global.png') })
})
