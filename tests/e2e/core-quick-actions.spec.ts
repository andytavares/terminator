import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  e2eTempDir,
  launchApp,
  openSettingsSection,
  projectGroup,
  runQuickActionFromPanel,
  readTerminalRows,
} from './helpers'
import { connectJira, startJiraStub, type JiraStub } from './jira-stub'
import { allowCredentialsWithoutKeychain, recordShellOpens, shellOpens } from './main-stubs'
import { runInVisibleTerminal } from './session-views'

// Every core Quick Action the rest of the suite never runs, run the way an
// operator finds one: ⌘P, `/`, its name, its row. Each step asserts what the
// action changes on screen, or what it handed the OS.

const sessionTabs = (page: Page) => page.locator('.tab-bar__tab--session')
const activeTab = (page: Page) => page.locator('.tab-bar__tab--session.tab-bar__tab--active')

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

// ---------------------------------------------------------------------------
// Terminal actions.
// ---------------------------------------------------------------------------

async function splitDownStacksPane(page: Page): Promise<void> {
  await expect(page.locator('.terminal-pane .xterm')).toHaveCount(1)
  await runQuickActionFromPanel(page, 'Split down')
  const panes = page.locator('.terminal-pane .xterm')
  await expect(panes).toHaveCount(2)
  const [top, bottom] = [await panes.nth(0).boundingBox(), await panes.nth(1).boundingBox()]
  expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 2)
  expect(Math.abs(bottom!.x - top!.x)).toBeLessThan(2)
}

async function closePaneKeepsOther(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'Close pane')
  await expect(page.locator('.terminal-pane .xterm')).toHaveCount(1)
}

async function clearWipesTerminal(page: Page): Promise<void> {
  await runInVisibleTerminal(page, 'echo qa-clear-marker')
  await expect.poll(() => screenText(page)).toContain('qa-clear-marker')
  await runQuickActionFromPanel(page, 'Clear')
  await expect.poll(() => screenText(page)).not.toContain('qa-clear-marker')
}

async function terminalActions(page: Page): Promise<void> {
  await test.step('Split down stacks a second pane under the focused one', () =>
    splitDownStacksPane(page))
  await test.step('Close pane closes the focused pane and keeps the other', () =>
    closePaneKeepsOther(page))
  await test.step('Clear wipes the focused terminal', () => clearWipesTerminal(page))
}

// ---------------------------------------------------------------------------
// Session actions.
// ---------------------------------------------------------------------------

async function previousTabMovesLeft(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'New tab')
  await expect(sessionTabs(page)).toHaveCount(2)
  await expect(sessionTabs(page).last()).toHaveClass(/tab-bar__tab--active/)
  await runQuickActionFromPanel(page, 'Previous tab')
  await expect(sessionTabs(page).first()).toHaveClass(/tab-bar__tab--active/)
}

async function recentSessionSwitches(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'Next recent session')
  await expect(sessionTabs(page).last()).toHaveClass(/tab-bar__tab--active/)
  await runQuickActionFromPanel(page, 'Previous recent session')
  await expect(sessionTabs(page).first()).toHaveClass(/tab-bar__tab--active/)
}

async function nextWaitingRevealsRungSession(page: Page): Promise<void> {
  const [first, last] = [sessionTabs(page).first(), sessionTabs(page).last()]
  for (const [label, from, to] of [
    ['Next waiting on you', first, last],
    ['Next waiting session', last, first],
  ] as const) {
    await to.click()
    await runInVisibleTerminal(page, "sleep 2; printf '\\a'")
    await from.click()
    await expect(to.locator('.tab-bar__state[aria-label="Waiting on you"]')).toBeVisible()
    await runQuickActionFromPanel(page, label)
    await expect(to).toHaveClass(/tab-bar__tab--active/)
  }
}

async function editSessionNoteShowsOnTab(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'Edit session note')
  const note = page.locator('.tab-bar__note-input')
  await expect(note).toBeFocused()
  await note.fill('reviewing the qa run')
  await note.press('Enter')
  await expect(activeTab(page)).toHaveAttribute('title', 'reviewing the qa run')
}

async function newScratchTerminalOpens(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'New scratch terminal')
  await expect(activeTab(page)).toContainText('Scratch')
  await projectGroup(page, 'alpha').click()
  await expect(activeTab(page)).toContainText('Terminal')
}

async function sessionActions(page: Page): Promise<void> {
  await test.step('Previous tab moves to the tab on the left', () => previousTabMovesLeft(page))
  await test.step('Next and previous recent session switch to the session attended before', () =>
    recentSessionSwitches(page))
  await test.step('Next waiting on you, from the sessions group or the top, reveals a session that rang', () =>
    nextWaitingRevealsRungSession(page))
  await test.step('Edit session note writes the note the tab then shows', () =>
    editSessionNoteShowsOnTab(page))
  await test.step('New scratch terminal opens a terminal outside any branch', () =>
    newScratchTerminalOpens(page))
}

// ---------------------------------------------------------------------------
// Navigation actions.
// ---------------------------------------------------------------------------

async function homeAndResumeOpenHome(page: Page): Promise<void> {
  const home = page.getByRole('heading', { name: 'Home', exact: true })
  for (const label of ['Home', 'Resume a conversation…']) {
    await projectGroup(page, 'alpha').click()
    await expect(home).toBeHidden()
    await runQuickActionFromPanel(page, label)
    await expect(home).toBeVisible()
  }
}

async function overviewTogglesWall(page: Page): Promise<void> {
  const wall = page.getByRole('heading', { name: 'Overview', exact: true })
  await runQuickActionFromPanel(page, 'Overview')
  await expect(wall).toBeVisible()
  await runQuickActionFromPanel(page, 'Overview')
  await expect(wall).toBeHidden()
}

async function toggleLogWindowOpensLog(page: Page): Promise<void> {
  const log = page.getByRole('region', { name: 'Application Logs' })
  await runQuickActionFromPanel(page, 'Toggle log window')
  await expect(log).toBeVisible()
  // The log covers the bottom of the band, Quick actions button included.
  await log.locator('.log-window__btn--close').click()
  await expect(log).toBeHidden()
}

async function workspaceActionsMoveActive(page: Page): Promise<void> {
  await projectGroup(page, 'alpha').click()
  expect(await activeWorkspaceName(page)).toBe('QA One')
  await runQuickActionFromPanel(page, 'Next workspace')
  expect(await activeWorkspaceName(page)).toBe('QA Two')
  await runQuickActionFromPanel(page, 'Previous workspace')
  expect(await activeWorkspaceName(page)).toBe('QA One')
}

async function navigationQuickActions(page: Page): Promise<void> {
  await test.step('Home and "Resume a conversation…" both open Home', () =>
    homeAndResumeOpenHome(page))
  await test.step('Overview opens the wall, and running it again closes it', () =>
    overviewTogglesWall(page))
  await test.step('Toggle log window opens the application log', () =>
    toggleLogWindowOpensLog(page))
  await test.step('Next and previous workspace move the active workspace', () =>
    workspaceActionsMoveActive(page))
}

// ---------------------------------------------------------------------------
// Issue actions, against a local Jira.
// ---------------------------------------------------------------------------

async function linkIssueAttachesToBranch(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'Link issue to branch')
  const dialog = page.getByRole('dialog', { name: 'Link an issue' })
  await dialog.getByPlaceholder('Search, or type an issue key').fill('login')
  await dialog.locator('.link-issue__row', { hasText: 'OPS-1' }).click()
  await dialog.getByRole('button', { name: 'Link OPS-1' }).click()
  await expect(dialog).toBeHidden()
  await expect(projectGroup(page, 'login-fix')).toContainText('OPS-1')
}

async function viewOpensIssueDrawer(page: Page): Promise<void> {
  await runQuickActionFromPanel(page, 'View OPS-1')
  const drawer = page.getByRole('complementary', { name: 'Issue OPS-1' })
  await expect(drawer.getByRole('heading', { name: 'Fix the login page' })).toBeVisible()
  await drawer.getByTitle('Close').click()
  await expect(drawer).toBeHidden()
}

async function copyIssueKeyFillsClipboard({ page, app }: AppHandle): Promise<void> {
  await app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'))
  await runQuickActionFromPanel(page, 'Copy issue key (OPS-1)')
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('OPS-1')
}

async function openInJiraOpensBrowser({ page, app }: AppHandle, stub: JiraStub): Promise<void> {
  await runQuickActionFromPanel(page, 'Open OPS-1 in Jira')
  await expect.poll(() => shellOpens(app)).toContain(`https://${stub.site}/browse/OPS-1`)
}

async function changeLinkedIssuePinsSession(page: Page): Promise<void> {
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

async function issueActions(handle: AppHandle, stub: JiraStub): Promise<void> {
  const { page } = handle
  await createWorkspace(page, 'Tracked', e2eTempDir('issue-'))
  await addAndSelectProject(page, 'Tracked', 'login-fix')
  await connectJira(page, stub)
  await test.step('Link issue to branch attaches a searched issue to the branch', () =>
    linkIssueAttachesToBranch(page))
  await test.step('View opens the linked issue in the drawer', () => viewOpensIssueDrawer(page))
  await test.step('Copy issue key puts the key on the clipboard', () =>
    copyIssueKeyFillsClipboard(handle))
  await test.step('Open in Jira hands the issue URL to the browser', () =>
    openInJiraOpensBrowser(handle, stub))
  await test.step('Change linked issue pins a different issue to the focused session only', () =>
    changeLinkedIssuePinsSession(page))
}

test.describe('core quick actions', () => {
  let handle: AppHandle
  let stub: JiraStub

  test.beforeAll(async () => {
    stub = await startJiraStub([
      { key: 'OPS-1', summary: 'Fix the login page', description: 'It breaks.', status: 'To Do' },
      { key: 'OPS-2', summary: 'Ship the audit log', description: 'Audit.', status: 'In Progress' },
    ])
    handle = await launchApp(undefined, { NODE_EXTRA_CA_CERTS: stub.caPath })
    await allowCredentialsWithoutKeychain(handle.app)
    await recordShellOpens(handle.app)
  })

  test.afterAll(async () => {
    await closeApp(handle)
    await stub.shutDown()
  })

  test('every core action changes what the operator sees, issue actions included', async () => {
    const { page } = handle
    await createWorkspace(page, 'QA One', e2eTempDir('qa1-'))
    await createWorkspace(page, 'QA Two', e2eTempDir('qa2-'))
    await addAndSelectProject(page, 'QA One', 'alpha')
    await terminalActions(page)
    await sessionActions(page)
    await navigationQuickActions(page)
    await issueActions(handle, stub)
  })
})
