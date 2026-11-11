import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  launchApp,
  closeApp,
  createWorkspace,
  e2eTempDir,
  projectGroup,
  openSettingsSection,
  closeSettingsPanel,
} from './helpers'
import type { AppHandle } from './helpers'
import { openHome } from './session-views'

// Reported: the Inbox stayed blank with three terminals open, and opening one more changed
// nothing. Their branches had been dismissed on Home earlier, and a dismissal hid every
// session started on the branch afterwards.

/** A repository with one commit on main, so its work key is `<folder>#main`. */
function gitFolder(): string {
  const folder = e2eTempDir('inbox-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
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

const inboxCards = (page: Page) => page.getByRole('list', { name: 'Inbox' }).getByRole('listitem')
const terminalTabs = (page: Page) => page.locator('.tab-bar__tab--session')

async function showInbox(page: Page): Promise<void> {
  await openSettingsSection(page, 'Appearance & Terminal')
  await page.locator('#sidebar-mode').selectOption('inbox')
  await closeSettingsPanel(page)
}

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await closeApp(handle)
})

test('a terminal opened on a dismissed branch shows in the Inbox', { tag: '@mac' }, async () => {
  const { page } = handle
  await createWorkspace(page, 'quicknote', gitFolder())
  await projectGroup(page, 'main').click()
  await expect(terminalTabs(page)).toHaveCount(1)
  await openHome(page)
  await page.getByRole('button', { name: 'Work actions' }).first().click()
  await page.locator('.ctx-menu__item', { hasText: 'Settle' }).click()
  await projectGroup(page, 'main').click()
  await page.locator('.tab-bar__new-tab').click()
  await expect(terminalTabs(page)).toHaveCount(2)
  await showInbox(page)
  await expect(inboxCards(page)).toHaveCount(1)
  await expect(inboxCards(page)).toContainText('main')
})

test('an Inbox card dragged onto an agent tab attaches its terminal as context', async () => {
  const { page } = handle
  await createWorkspace(page, 'quicknote', gitFolder())
  await projectGroup(page, 'main').click()
  await expect(terminalTabs(page)).toHaveCount(1)
  await openHome(page)
  await page.locator('.task-row__name', { hasText: 'main' }).first().click()
  await page.getByRole('button', { name: 'New agent on this branch' }).click()
  await expect(page.locator('.agent-composer')).toBeVisible()
  await showInbox(page)
  await inboxCards(page)
    .first()
    .locator('.inbox-card__open')
    .dragTo(page.locator('.agent-composer'))
  await expect(page.locator('.agent-context-chip')).toContainText('terminal output')
})
