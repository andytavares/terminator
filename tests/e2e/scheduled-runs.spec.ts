import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { agentRecordFile, closeApp, e2eTempDir, launchApp, type AppHandle } from './helpers'
import { openHome } from './session-views'

/** A global scheduled run (ADR 143): saved from Start work, then run, paused, edited and removed
 * from Home's Scheduled view. The stub agent (fixtures/acp-stub-agent.mjs) records each session. */

let handle: AppHandle

const PROMPT = 'Summarise yesterday’s merged pull requests'

interface SessionRecord {
  kind: string
  cwd?: string
}

function sessions(): SessionRecord[] {
  const file = agentRecordFile(handle.userDataDir)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionRecord)
    .filter((record) => record.kind === 'session')
}

test.beforeAll(async () => {
  handle = await launchApp(e2eTempDir('scheduled-runs-'))
})

test.afterAll(async () => closeApp(handle))

const scheduledTable = () => handle.page.getByRole('table', { name: 'Scheduled runs' })
const runRow = () => scheduledTable().getByRole('row').filter({ hasText: PROMPT })

async function rowAction(action: string): Promise<void> {
  const { page } = handle
  await page.getByRole('button', { name: `Actions for ${PROMPT}` }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

async function scheduleAGlobalRepeat(): Promise<void> {
  const { page } = handle
  await openHome(page)
  await page.getByRole('button', { name: /^Start work/ }).click()
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  await launcher.getByLabel('What should it do?').fill(PROMPT)
  await launcher.getByRole('button', { name: /^Workspace:/ }).click()
  await page
    .getByRole('listbox', { name: 'Workspace' })
    .getByRole('option', { name: /^Global/ })
    .click()
  await expect(launcher.getByRole('button', { name: 'Workspace: Global' })).toBeVisible()
  await launcher.getByRole('radio', { name: 'Repeat' }).click()
  await launcher.getByRole('button', { name: /^Schedule/ }).click()
  await expect(launcher).toBeHidden()
}

async function theRunShowsUnderGlobal(): Promise<void> {
  const { page } = handle
  await openHome(page)
  await page.getByRole('radio', { name: 'Scheduled' }).click()
  const global = scheduledTable().getByRole('rowgroup').filter({ hasText: 'Global — no workspace' })
  await expect(global.getByRole('row').filter({ hasText: PROMPT })).toContainText(
    'every day at 09:00'
  )
}

async function runNowStartsAnAgentInTheHomeFolder(): Promise<void> {
  const home = await handle.app.evaluate(() => process.env.HOME)
  await rowAction('Run now')
  await expect.poll(() => sessions().map((s) => s.cwd)).toEqual([home])
  await expect(handle.page.getByLabel('Message the agent')).toBeVisible()
}

async function pauseShowsThePausedChip(): Promise<void> {
  await openHome(handle.page)
  await rowAction('Pause')
  await expect(runRow()).toContainText('Paused')
}

async function editChangesTheTime(): Promise<void> {
  const { page } = handle
  await rowAction('Edit…')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await expect(launcher.getByText('Edit scheduled run')).toBeVisible()
  await launcher.getByLabel('Time', { exact: true }).fill('14:30')
  await launcher.getByRole('button', { name: /^Save changes/ }).click()
  await expect(launcher).toBeHidden()
  await expect(runRow()).toContainText('every day at 14:30')
}

async function removeAsksThenEmptiesTheView(): Promise<void> {
  const { page } = handle
  await rowAction('Remove…')
  const confirm = page.getByRole('dialog', { name: 'Remove this scheduled run?' })
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('No scheduled runs')).toBeVisible()
}

test('a global scheduled run is run, paused, edited and removed from Home', async () => {
  await test.step('Start work saves a global repeat', scheduleAGlobalRepeat)
  await test.step('Home → Scheduled lists it under Global', theRunShowsUnderGlobal)
  await test.step(
    'Run now starts an agent in the home folder, shown in Scratch',
    runNowStartsAnAgentInTheHomeFolder
  )
  await test.step('Pause shows the Paused chip', pauseShowsThePausedChip)
  await test.step('Edit… saves a new time', editChangesTheTime)
  await test.step('Remove… asks, then the view is empty', removeAsksThenEmptiesTheView)
})
