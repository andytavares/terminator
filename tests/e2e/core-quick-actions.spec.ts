import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  launchApp,
  openSettingsSection,
  projectGroup,
  runQuickActionFromPanel,
  readTerminalRows,
} from './helpers'
import { connectJira, startJiraStub, type JiraStub } from './jira-stub'
import { allowCredentialsWithoutKeychain, recordShellOpens, shellOpens } from './main-stubs'

// Every core Quick Action the rest of the suite never runs, run the way an
// operator finds one: ⌘P, `/`, its name, its row. Each test asserts what the
// action changes on screen, or what it handed the OS.

const sessionTabs = (page: Page) => page.locator('.tab-bar__tab--session')
const activeTab = (page: Page) => page.locator('.tab-bar__tab--session.tab-bar__tab--active')

/** Types a command into the focused terminal and runs it. */
async function typeInTerminal(page: Page, command: string): Promise<void> {
  await page.locator('.terminal-pane .xterm').first().click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** The text on the open terminals' screens. */
async function screenText(page: Page): Promise<string> {
  return (await readTerminalRows(page)).join('\n')
}

async function activeWorkspaceName(page: Page): Promise<string> {
  await openSettingsSection(page, 'Workspace Settings')
  const title = (await page.locator('.settings-section__title').first().textContent()) ?? ''
  await closeSettingsPanel(page)
  return title.replace('Settings for: ', '')
}

let handle: AppHandle

async function splitDownStacksPane(): Promise<void> {
  const { page } = handle
  await expect(page.locator('.terminal-pane .xterm')).toHaveCount(1)
  await runQuickActionFromPanel(page, 'Split down')
  const panes = page.locator('.terminal-pane .xterm')
  await expect(panes).toHaveCount(2, { timeout: 15000 })
  const [top, bottom] = [await panes.nth(0).boundingBox(), await panes.nth(1).boundingBox()]
  expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 2)
  expect(Math.abs(bottom!.x - top!.x)).toBeLessThan(2)
}

async function closePaneKeepsOther(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'Close pane')
  await expect(page.locator('.terminal-pane .xterm')).toHaveCount(1, { timeout: 15000 })
}

async function clearWipesTerminal(): Promise<void> {
  const { page } = handle
  await typeInTerminal(page, 'echo qa-clear-marker')
  await expect.poll(() => screenText(page)).toContain('qa-clear-marker')
  await runQuickActionFromPanel(page, 'Clear')
  await expect.poll(() => screenText(page), { timeout: 10000 }).not.toContain('qa-clear-marker')
}

async function previousTabMovesLeft(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'New tab')
  await expect(sessionTabs(page)).toHaveCount(2)
  await expect(sessionTabs(page).last()).toHaveClass(/tab-bar__tab--active/)
  await runQuickActionFromPanel(page, 'Previous tab')
  await expect(sessionTabs(page).first()).toHaveClass(/tab-bar__tab--active/)
}

async function recentSessionSwitches(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'Next recent session')
  await expect(sessionTabs(page).last()).toHaveClass(/tab-bar__tab--active/)
  await runQuickActionFromPanel(page, 'Previous recent session')
  await expect(sessionTabs(page).first()).toHaveClass(/tab-bar__tab--active/)
}

async function nextWaitingRevealsRungSession(): Promise<void> {
  const { page } = handle
  const [first, last] = [sessionTabs(page).first(), sessionTabs(page).last()]
  for (const [label, from, to] of [
    ['Next waiting on you', first, last],
    ['Next waiting session', last, first],
  ] as const) {
    await to.click()
    await typeInTerminal(page, "sleep 2; printf '\\a'")
    await from.click()
    await expect(to.locator('.tab-bar__state[aria-label="Waiting on you"]')).toBeVisible({
      timeout: 15000,
    })
    await runQuickActionFromPanel(page, label)
    await expect(to).toHaveClass(/tab-bar__tab--active/)
  }
}

async function editSessionNoteShowsOnTab(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'Edit session note')
  const note = page.locator('.tab-bar__note-input')
  await expect(note).toBeFocused()
  await note.fill('reviewing the qa run')
  await note.press('Enter')
  await expect(activeTab(page)).toHaveAttribute('title', 'reviewing the qa run')
}

async function newScratchTerminalOpens(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'New scratch terminal')
  await expect(activeTab(page)).toContainText('Scratch', { timeout: 15000 })
  await projectGroup(page, 'alpha').click()
  await expect(activeTab(page)).toContainText('Terminal')
}

async function homeAndResumeOpenHome(): Promise<void> {
  const { page } = handle
  const home = page.getByRole('heading', { name: 'Home', exact: true })
  for (const label of ['Home', 'Resume a conversation…']) {
    await projectGroup(page, 'alpha').click()
    await expect(home).toBeHidden()
    await runQuickActionFromPanel(page, label)
    await expect(home).toBeVisible()
  }
}

async function overviewTogglesWall(): Promise<void> {
  const { page } = handle
  const wall = page.getByRole('heading', { name: 'Overview', exact: true })
  await runQuickActionFromPanel(page, 'Overview')
  await expect(wall).toBeVisible()
  await runQuickActionFromPanel(page, 'Overview')
  await expect(wall).toBeHidden()
}

async function toggleLogWindowOpensLog(): Promise<void> {
  const { page } = handle
  const log = page.getByRole('dialog', { name: 'Application Logs' })
  await runQuickActionFromPanel(page, 'Toggle log window')
  await expect(log).toBeVisible()
  // The log covers the bottom of the band, Quick actions button included.
  await log.locator('.log-window__btn--close').click()
  await expect(log).toBeHidden()
}

async function workspaceActionsMoveActive(): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'alpha').click()
  expect(await activeWorkspaceName(page)).toBe('QA One')
  await runQuickActionFromPanel(page, 'Next workspace')
  expect(await activeWorkspaceName(page)).toBe('QA Two')
  await runQuickActionFromPanel(page, 'Previous workspace')
  expect(await activeWorkspaceName(page)).toBe('QA One')
}

test.describe.serial('terminal, session and navigation actions', () => {
  test.beforeAll(async () => {
    handle = await launchApp()
    const { page } = handle
    await createWorkspace(page, 'QA One', mkdtempSync(join(tmpdir(), 'terminator-e2e-qa1-')))
    await createWorkspace(page, 'QA Two', mkdtempSync(join(tmpdir(), 'terminator-e2e-qa2-')))
    await addAndSelectProject(page, 'QA One', 'alpha')
  })

  test.afterAll(async () => closeApp(handle))

  test('Split down stacks a second pane under the focused one', splitDownStacksPane)

  test('Close pane closes the focused pane and keeps the other', closePaneKeepsOther)

  test('Clear wipes the focused terminal', clearWipesTerminal)

  test('Previous tab moves to the tab on the left', previousTabMovesLeft)

  test(
    'Next and previous recent session switch to the session attended before',
    recentSessionSwitches
  )

  test(
    'Next waiting on you, from the sessions group or the top, reveals a session that rang',
    nextWaitingRevealsRungSession
  )

  test('Edit session note writes the note the tab then shows', editSessionNoteShowsOnTab)

  test('New scratch terminal opens a terminal outside any branch', newScratchTerminalOpens)

  test('Home and "Resume a conversation…" both open Home', homeAndResumeOpenHome)

  test('Overview opens the wall, and running it again closes it', overviewTogglesWall)

  test('Toggle log window opens the application log', toggleLogWindowOpensLog)

  test('Next and previous workspace move the active workspace', workspaceActionsMoveActive)
})

/** The app, on a branch of a workspace, connected to the stub Jira. */
async function appConnectedToJira(stub: JiraStub): Promise<AppHandle> {
  const tracked = await launchApp(undefined, { NODE_EXTRA_CA_CERTS: stub.caPath })
  await allowCredentialsWithoutKeychain(tracked.app)
  await recordShellOpens(tracked.app)
  const { page } = tracked
  await createWorkspace(page, 'Tracked', mkdtempSync(join(tmpdir(), 'terminator-e2e-issue-')))
  await addAndSelectProject(page, 'Tracked', 'login-fix')
  await connectJira(page, stub)
  return tracked
}

async function linkIssueAttachesToBranch(tracked: AppHandle): Promise<void> {
  const { page } = tracked
  await runQuickActionFromPanel(page, 'Link issue to branch')
  const dialog = page.getByRole('dialog', { name: 'Link an issue' })
  await dialog.getByPlaceholder('Search, or type an issue key').fill('login')
  await dialog.locator('.link-issue__row', { hasText: 'OPS-1' }).click()
  await dialog.getByRole('button', { name: 'Link OPS-1' }).click()
  await expect(dialog).toBeHidden()
  await expect(projectGroup(page, 'login-fix')).toContainText('OPS-1')
}

async function viewOpensIssueDrawer(tracked: AppHandle): Promise<void> {
  const { page } = tracked
  await runQuickActionFromPanel(page, 'View OPS-1')
  const drawer = page.getByRole('complementary', { name: 'Issue OPS-1' })
  await expect(drawer.getByRole('heading', { name: 'Fix the login page' })).toBeVisible()
  await drawer.getByTitle('Close').click()
  await expect(drawer).toBeHidden()
}

async function copyIssueKeyFillsClipboard(tracked: AppHandle): Promise<void> {
  const { page, app } = tracked
  await app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'))
  await runQuickActionFromPanel(page, 'Copy issue key (OPS-1)')
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('OPS-1')
}

async function openInJiraOpensBrowser(tracked: AppHandle, stub: JiraStub): Promise<void> {
  const { page, app } = tracked
  await runQuickActionFromPanel(page, 'Open OPS-1 in Jira')
  await expect.poll(() => shellOpens(app)).toContain(`https://${stub.site}/browse/OPS-1`)
}

async function changeLinkedIssuePinsSession(tracked: AppHandle): Promise<void> {
  const { page } = tracked
  // The session already resolves to its branch's issue, so the action offers a change.
  await runQuickActionFromPanel(page, 'Change linked issue')
  const dialog = page.getByRole('dialog', { name: 'Link a work item' })
  await dialog.getByPlaceholder('Search, or type an issue key').fill('audit')
  await dialog.locator('.issue-picker__row', { hasText: 'OPS-2' }).click()
  await dialog.getByRole('button', { name: 'Link OPS-2' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.tab-bar__tab--active .tab-bar__key')).toHaveText('OPS-2')
  await expect(projectGroup(page, 'login-fix')).toContainText('OPS-1')
}

test.describe.serial('issue actions, against a local Jira', () => {
  let tracked: AppHandle
  let stub: JiraStub

  test.beforeAll(async () => {
    stub = await startJiraStub([
      { key: 'OPS-1', summary: 'Fix the login page', description: 'It breaks.', status: 'To Do' },
      { key: 'OPS-2', summary: 'Ship the audit log', description: 'Audit.', status: 'In Progress' },
    ])
    tracked = await appConnectedToJira(stub)
  })

  test.afterAll(async () => {
    await closeApp(tracked)
    await stub.close()
  })

  test('Link issue to branch attaches a searched issue to the branch', () =>
    linkIssueAttachesToBranch(tracked))

  test('View opens the linked issue in the drawer', () => viewOpensIssueDrawer(tracked))

  test('Copy issue key puts the key on the clipboard', () => copyIssueKeyFillsClipboard(tracked))

  test('Open in Jira hands the issue URL to the browser', () =>
    openInJiraOpensBrowser(tracked, stub))

  test('Change linked issue pins a different issue to the focused session only', () =>
    changeLinkedIssuePinsSession(tracked))
})
