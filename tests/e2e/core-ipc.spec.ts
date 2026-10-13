import { test, expect, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  inExtensionView,
  launchApp,
  projectGroup,
  quickActionsPanel,
  runQuickAction,
  terminalRowsIn,
  visibleTerminalScreen,
  workspaceRow,
} from './helpers'
import { git, makeFixtureRepo } from './foundry-harness'
import { answerFolderPicker, recordShellOpens, shellOpens } from './main-stubs'

// The core channels no other spec reaches: branches in a real repository,
// renaming and removing cards, notifications, links opened from a terminal,
// and the parts of window.electronAPI only an extension's view calls. Those
// last run inside Notes' own view, through the same preload every extension
// view gets.

const NOTES = 'terminator.notepad'

/** Opens Notes, so its view is loaded, and waits for its bridge. */
async function openNotesView(handle: AppHandle): Promise<void> {
  const panel = handle.page.locator(`[data-extension-panel="${NOTES}"]`)
  if ((await panel.count()) === 0) await handle.page.locator('button[aria-label="Notes"]').click()
  await expect(panel).toHaveCount(1, { timeout: 15000 })
  await expect
    .poll(() => inExtensionView<boolean>(handle, NOTES, '!!window.electronAPI').catch(() => false))
    .toBe(true)
}

/** Calls window.electronAPI in Notes' view: `call` is an expression over `api`. */
function fromView<T>(handle: AppHandle, call: string): Promise<T> {
  return inExtensionView<T>(handle, NOTES, `(async (api) => ${call})(window.electronAPI)`)
}

function currentBranch(repo: string): string {
  return execFileSync('git', ['branch', '--show-current'], { cwd: repo }).toString().trim()
}

/**
 * Prints `line` alone on a row of the terminal drawn in `screen`, a pane's
 * `.xterm-screen`, and ⌘-clicks it (Ctrl-click off macOS) at the row's first
 * characters. xterm sizes the screen to exactly its rows, so a row is the
 * screen's height over the number of rows that terminal shows.
 */
async function printAndModClick(screen: Locator, line: string): Promise<void> {
  const page = screen.page()
  await screen.click()
  await page.keyboard.type(`printf '%s\\n' '${line}'`)
  await page.keyboard.press('Enter')
  const rowsOfLine = async () =>
    (await terminalRowsIn(screen)).filter((row) => row.startsWith(line)).length
  await expect.poll(rowsOfLine).toBe(1)
  const rows = await terminalRowsIn(screen)
  const index = rows.findIndex((row) => row.startsWith(line))
  const box = (await screen.boundingBox())!
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.down(modifier)
  await page.mouse.click(box.x + 20, box.y + ((index + 0.5) * box.height) / rows.length)
  await page.keyboard.up(modifier)
}

async function removeBranchTakesCardOff(handle: AppHandle): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'main').click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Remove branch' }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.locator('.branch-row__name', { hasText: /^main$/ })).toHaveCount(0)
}

async function fetchListsRemoteBranch(
  handle: AppHandle,
  repo: string,
  remote: string
): Promise<void> {
  const { page } = handle
  const other = mkdtempSync(join(tmpdir(), 'terminator-e2e-clone-'))
  execFileSync('git', ['clone', remote, other])
  git(other, 'checkout', '-b', 'pushed-elsewhere')
  git(other, 'push', 'origin', 'pushed-elsewhere')
  await workspaceRow(page, 'Repo').hover()
  await workspaceRow(page, 'Repo')
    .locator('.repo-header__action[aria-label="New branch in Repo"]')
    .click()
  await page.locator('.branch-select__trigger').click()
  await expect(
    page.locator('.branch-select__item-name', { hasText: 'pushed-elsewhere' })
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Fetch branches' }).click()
  await expect(
    page.locator('.branch-select__item-name', { hasText: 'pushed-elsewhere' }).first()
  ).toBeVisible()
}

async function dialogBranchIsCreated(handle: AppHandle, repo: string): Promise<void> {
  const { page } = handle
  await page.locator('.branch-select__item', { hasText: '+ New branch…' }).click()
  await page.getByPlaceholder('feature/my-feature').fill('made-in-app')
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(projectGroup(page, 'made-in-app')).toBeVisible()
  const branches = execFileSync('git', ['branch', '--list', 'made-in-app'], { cwd: repo })
  expect(branches.toString()).toContain('made-in-app')
}

async function viewCheckoutMovesCard(handle: AppHandle, repo: string): Promise<void> {
  await openNotesView(handle)
  const result = await fromView(handle, `api.git.checkout(${JSON.stringify(repo)}, 'made-in-app')`)
  expect(result).toEqual({ success: true })
  expect(currentBranch(repo)).toBe('made-in-app')
}

async function viewWorktreeRemovalDeletesIt(handle: AppHandle, repo: string): Promise<void> {
  const worktree = join(mkdtempSync(join(tmpdir(), 'terminator-e2e-wt-')), 'wt')
  git(repo, 'worktree', 'add', '-b', 'to-remove', worktree)
  expect(existsSync(worktree)).toBe(true)
  const result = await fromView(
    handle,
    `api.git.removeWorktree(${JSON.stringify(repo)}, ${JSON.stringify(worktree)})`
  )
  expect(result).toEqual({ success: true })
  expect(existsSync(worktree)).toBe(false)
}

async function viewShellExecIsConfined(handle: AppHandle, repo: string): Promise<void> {
  const ran = await fromView<{ exitCode: number; stdout: string }>(
    handle,
    `api.shell.exec({ command: 'git', args: ['branch', '--show-current'], cwd: ${JSON.stringify(repo)} })`
  )
  expect(ran).toMatchObject({ exitCode: 0, stdout: 'made-in-app\n' })
  const outside = await fromView(
    handle,
    `api.shell.exec({ command: 'git', args: ['status'], cwd: ${JSON.stringify(tmpdir())}, workspaceRoot: ${JSON.stringify(repo)} })`
  )
  expect(outside).toEqual({ error: 'CWD_OUT_OF_SCOPE' })
  const notGit = await fromView<{ error: string }>(
    handle,
    `api.shell.exec({ command: 'ls', args: [], cwd: ${JSON.stringify(repo)} })`
  )
  expect(notGit.error).toBe('VALIDATION_ERROR')
}

test.describe.serial('branches in a git repository', () => {
  let handle: AppHandle
  let repo: string
  let remote: string

  test.beforeAll(async () => {
    remote = mkdtempSync(join(tmpdir(), 'terminator-e2e-remote-'))
    execFileSync('git', ['init', '--bare', '-b', 'main', remote])
    repo = makeFixtureRepo('terminator-e2e-branches-')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-u', 'origin', 'main')
    handle = await launchApp()
    await createWorkspace(handle.page, 'Repo', repo)
    await expect(projectGroup(handle.page, 'main')).toBeVisible()
  })

  test.afterAll(async () => closeApp(handle))

  test('Remove branch takes the card off the sidebar', () => removeBranchTakesCardOff(handle))

  test('Fetch lists a branch pushed elsewhere since the last fetch', () =>
    fetchListsRemoteBranch(handle, repo, remote))

  test('a new branch from the dialog is created in the repository', () =>
    dialogBranchIsCreated(handle, repo))

  test("an extension view's checkout moves the repository, and the card follows", () =>
    viewCheckoutMovesCard(handle, repo))

  test("an extension view's worktree removal deletes the worktree", () =>
    viewWorktreeRemovalDeletesIt(handle, repo))

  test("an extension view's shell.exec runs git where it is allowed and nowhere else", () =>
    viewShellExecIsConfined(handle, repo))
})

async function browseFillsFolder(handle: AppHandle, folder: string): Promise<void> {
  const { page, app } = handle
  await answerFolderPicker(app, folder)
  await page.click('.sidebar-header__add')
  await page.getByPlaceholder('My Workspace').fill('Plain')
  await page.getByRole('button', { name: 'Browse' }).click()
  await expect(page.getByPlaceholder('/path/to/folder')).toHaveValue(folder)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(workspaceRow(page, 'Plain')).toBeVisible()
  await addAndSelectProject(page, 'Plain', 'scratchpad')
}

async function renameRenamesPlainCard(handle: AppHandle): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'scratchpad').click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Rename' }).click()
  const input = page.locator('.branch-row__rename')
  await input.fill('notebook')
  await input.press('Enter')
  await expect(projectGroup(page, 'notebook')).toBeVisible()
  await page.reload()
  await expect(projectGroup(page, 'notebook')).toBeVisible()
}

async function urlOpensOnModClick(handle: AppHandle): Promise<void> {
  const { page, app } = handle
  await projectGroup(page, 'notebook').click()
  // Two terminals on screen, so the click has to find the row in the right one.
  // The split stays for the bell test, whose new tab must show alone and take the keys.
  await runQuickAction(page, 'Split down')
  const screens = page.locator('.terminal-pane .xterm-screen').filter({ visible: true })
  await expect(screens).toHaveCount(2, { timeout: 15000 })
  await printAndModClick(screens.last(), 'https://example.com/e2e-link')
  await expect.poll(() => shellOpens(app)).toContain('https://example.com/e2e-link')
}

async function filePathOpensOnModClick(handle: AppHandle, folder: string): Promise<void> {
  const { page, app } = handle
  const file = join(folder, 'notes.txt')
  writeFileSync(file, 'hello')
  await printAndModClick(visibleTerminalScreen(page), file)
  await expect.poll(() => shellOpens(app)).toContain(file)
}

async function bellNotifiesAndReveals(handle: AppHandle): Promise<void> {
  const { page } = handle
  await runQuickAction(page, 'New tab')
  const tabs = page.locator('.tab-bar__tab--session')
  await page.keyboard.type("sleep 2; printf '\\a'")
  await page.keyboard.press('Enter')
  await tabs.first().click()
  const bell = page.locator('.app-band__entry[aria-label^="Notifications"]')
  await expect(bell).toHaveAttribute('aria-label', /unread/, { timeout: 15000 })
  await bell.click()
  const item = page.locator('.notif-item', { hasText: 'needs attention' }).first()
  await expect(item).toBeVisible()
  await item.click()
  await expect(tabs.last()).toHaveClass(/tab-bar__tab--active/)
  await bell.click()
  const before = await page.locator('.notif-item').count()
  await page.locator('.notif-item__dismiss').first().click()
  await expect(page.locator('.notif-item')).toHaveCount(before - 1)
  const listed = await page.evaluate(() => window.electronAPI.notifications.list())
  expect(listed.length).toBe(before - 1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.notif-item')).toHaveCount(0)
}

async function quickActionsOpenInsideView(handle: AppHandle): Promise<void> {
  await openNotesView(handle)
  await handle.app.evaluate(({ webContents }, part) => {
    const view = webContents.getAllWebContents().find((w) => w.getURL().includes(part))!
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'] as never
    view.focus()
    view.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers })
    view.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers })
  }, NOTES)
  await expect(quickActionsPanel(handle.page)).toBeVisible()
  await handle.page.keyboard.press('Escape')
}

async function viewGetActiveNamesSelection(handle: AppHandle, folder: string): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'notebook').click()
  await openNotesView(handle)
  const active = await fromView<{ workspaceId: string; repoRoot: string }>(
    handle,
    'api.workspace.getActive()'
  )
  const { workspaces } = await page.evaluate(() => window.electronAPI.workspace.list())
  expect(active.workspaceId).toBe(workspaces.find((w) => w.name === 'Plain')!.id)
  expect(active.repoRoot).toBe(folder)
}

async function viewFileWatchReportsUntilStopped(handle: AppHandle, folder: string): Promise<void> {
  const watched = join(folder, 'watched')
  const other = join(folder, 'other')
  mkdirSync(watched)
  mkdirSync(other)
  await fromView(
    handle,
    `(window.__fsEvents = [], api.fs.onChanged((e) => window.__fsEvents.push(e)), api.fs.watchStart(${JSON.stringify(watched)}))`
  )
  writeFileSync(join(watched, 'first.txt'), '1')
  const roots = () => fromView<string[]>(handle, 'window.__fsEvents.map((e) => e.projectRoot)')
  await expect.poll(roots).toContain(watched)
  expect(await fromView(handle, 'api.fs.watchStop()')).toEqual({ ok: true })
  await fromView(handle, `(window.__fsEvents = [], api.fs.watchStart(${JSON.stringify(other)}))`)
  writeFileSync(join(watched, 'after-stop.txt'), '2')
  writeFileSync(join(other, 'second.txt'), '3')
  await expect.poll(roots).toContain(other)
  expect(await roots()).not.toContain(watched)
  await fromView(handle, 'api.fs.watchStop()')
}

async function viewReadFileReadsOrReportsMissing(handle: AppHandle, folder: string): Promise<void> {
  const file = join(folder, 'read-me.md')
  writeFileSync(file, '# Template\n')
  expect(await fromView(handle, `api.fs.readFile(${JSON.stringify(file)})`)).toEqual({
    content: '# Template\n',
  })
  expect(await fromView(handle, `api.fs.readFile(${JSON.stringify(file + '.gone')})`)).toEqual({
    error: 'FILE_NOT_FOUND',
  })
}

async function viewListsAndClosesSessions(handle: AppHandle): Promise<void> {
  const { page } = handle
  const listed = await fromView<Array<{ tabTitle: string }>>(handle, 'api.terminal.listSessions()')
  expect(listed.map((s) => s.tabTitle)).toEqual(
    expect.arrayContaining(['Terminal 1', 'Terminal 2'])
  )
  await projectGroup(page, 'notebook').click()
  const open = await page.locator('.tab-bar__tab--session').count()
  const closed = await fromView<{ terminatedCount: number }>(handle, 'api.terminal.closeAll()')
  expect(closed.terminatedCount).toBe(listed.length)
  expect(await fromView(handle, 'api.terminal.listSessions()')).toEqual([])
  // Every tab that was open says its terminal ended.
  const ended = page.locator('.tab-bar__tab--session', { hasText: '[exited]' })
  await expect(ended).toHaveCount(open)
  await expect(ended.locator('.tab-bar__state[aria-label="Exited"]')).toHaveCount(open)
}

test.describe.serial('cards, terminals and notifications in a plain folder', () => {
  let handle: AppHandle
  let folder: string

  test.beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'terminator-e2e-plain-'))
    handle = await launchApp()
    await recordShellOpens(handle.app)
  })

  test.afterAll(async () => closeApp(handle))

  test('Browse fills the workspace folder from the OS folder picker', () =>
    browseFillsFolder(handle, folder))

  test('Rename renames a card that no git branch names', () => renameRenamesPlainCard(handle))

  test('a URL in a terminal opens in the browser on ⌘-click (Ctrl-click off macOS)', () =>
    urlOpensOnModClick(handle))

  test('a file path in a terminal opens in its app on ⌘-click (Ctrl-click off macOS)', () =>
    filePathOpensOnModClick(handle, folder))

  test('a bell in a background tab notifies; clicking it reveals the tab, × dismisses', () =>
    bellNotifiesAndReveals(handle))

  test("⌘P (Ctrl+P off macOS) inside an extension's view opens Quick Actions", () =>
    quickActionsOpenInsideView(handle))

  test("an extension view's getActive names the workspace and branch on screen", () =>
    viewGetActiveNamesSelection(handle, folder))

  test("an extension view's file watch reports changes until it is stopped", () =>
    viewFileWatchReportsUntilStopped(handle, folder))

  test("an extension view's readFile returns a file's text, or says it is missing", () =>
    viewReadFileReadsOrReportsMissing(handle, folder))

  test("an extension view's listSessions and closeAll see and end every terminal", () =>
    viewListsAndClosesSessions(handle))
})
