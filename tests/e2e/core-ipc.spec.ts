import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  closeApp,
  createWorkspace,
  e2eTempDir,
  inExtensionView,
  launchApp,
  projectGroup,
  quickActionsPanel,
} from './helpers'
import { git, makeFixtureRepo } from './foundry-harness'
import { extensionFrame } from './extension-page'

// The parts of window.electronAPI only an extension's view calls, run inside Notes' view
// through the preload every view gets. The handlers behind them have integration tests in
// tests/integration/ipc; this proves a view reaches them.

const NOTES = 'terminator.notepad'
const WS = 'Repo'

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  repo = makeFixtureRepo('terminator-e2e-core-ipc-')
  git(repo, 'branch', 'made-in-app')
  handle = await launchApp()
  await createWorkspace(handle.page, WS, repo)
  await projectGroup(handle.page, 'main').click()
  await handle.page.keyboard.press('ControlOrMeta+t')
  await expect(handle.page.locator('.tab-bar__tab--session')).toHaveCount(2)
})

test.afterAll(async () => closeApp(handle))

/** Opens Notes, so its view is loaded, and waits for its bridge. */
async function openNotesView(): Promise<void> {
  const panel = handle.page.locator(`[data-extension-panel="${NOTES}"]`)
  if ((await panel.count()) === 0) await handle.page.locator('button[aria-label="Notes"]').click()
  await expect(panel).toHaveCount(1)
  await expect
    .poll(() => inExtensionView<boolean>(handle, NOTES, '!!window.electronAPI').catch(() => false))
    .toBe(true)
}

/** Calls window.electronAPI in Notes' view: `call` is an expression over `api`. */
function fromView<T>(call: string): Promise<T> {
  return inExtensionView<T>(handle, NOTES, `(async (api) => ${call})(window.electronAPI)`)
}

async function getActiveNamesSelection(): Promise<void> {
  await openNotesView()
  const active = await fromView<{ workspaceId: string; repoRoot: string }>(
    'api.workspace.getActive()'
  )
  const { workspaces } = await handle.page.evaluate(() => window.electronAPI.workspace.list())
  expect(active.workspaceId).toBe(workspaces.find((w) => w.name === WS)!.id)
  // A repository's root is git's top level, which resolves the temp dir's symlink.
  expect(active.repoRoot).toBe(realpathSync(repo))
}

async function readFileReadsOrReportsMissing(): Promise<void> {
  const file = join(repo, 'read-me.md')
  writeFileSync(file, '# Template\n')
  expect(await fromView(`api.fs.readFile(${JSON.stringify(file)})`)).toEqual({
    content: '# Template\n',
  })
  expect(await fromView(`api.fs.readFile(${JSON.stringify(file + '.gone')})`)).toEqual({
    error: 'FILE_NOT_FOUND',
  })
}

/** Writes in each directory again on every look, until the view is told about `expected`: macOS
 * arms a watch a moment after it starts, and a change made before that has no event. */
async function writeUntilViewIsTold(directories: string[], expected: string): Promise<string[]> {
  const roots = () => fromView<string[]>('window.__fsEvents.map((e) => e.projectRoot)')
  await expect
    .poll(async () => {
      for (const directory of directories)
        writeFileSync(join(directory, 'file.txt'), `${Date.now()}`)
      return roots()
    })
    .toContain(expected)
  return roots()
}

async function fileWatchReportsUntilStopped(): Promise<void> {
  const [watched, other] = [join(repo, 'watched'), join(repo, 'other')]
  mkdirSync(watched)
  mkdirSync(other)
  await handle.page.evaluate(
    '(window.__windowFsEvents = [], window.electronAPI.fs.onChanged((e) => window.__windowFsEvents.push(e)), null)'
  )
  await fromView(
    `(window.__fsEvents = [], api.fs.onChanged((e) => window.__fsEvents.push(e)), api.fs.watchStart(${JSON.stringify(watched)}))`
  )
  await writeUntilViewIsTold([watched], watched)
  // The view asked, so the view is told: the window, which did not, hears nothing.
  expect(await handle.page.evaluate('window.__windowFsEvents')).toEqual([])
  expect(await fromView('api.fs.watchStop()')).toEqual({ ok: true })
  await fromView(`(window.__fsEvents = [], api.fs.watchStart(${JSON.stringify(other)}))`)
  expect(await writeUntilViewIsTold([watched, other], other)).not.toContain(watched)
  await fromView('api.fs.watchStop()')
}

async function shellExecIsConfined(): Promise<void> {
  const ran = await fromView<{ exitCode: number; stdout: string }>(
    `api.shell.exec({ command: 'git', args: ['branch', '--show-current'], cwd: ${JSON.stringify(repo)} })`
  )
  expect(ran).toMatchObject({ exitCode: 0, stdout: 'main\n' })
  const outside = await fromView(
    `api.shell.exec({ command: 'git', args: ['status'], cwd: ${JSON.stringify(tmpdir())}, workspaceRoot: ${JSON.stringify(repo)} })`
  )
  expect(outside).toEqual({ error: 'CWD_OUT_OF_SCOPE' })
  const notGit = await fromView<{ error: string }>(
    `api.shell.exec({ command: 'ls', args: [], cwd: ${JSON.stringify(repo)} })`
  )
  expect(notGit.error).toBe('VALIDATION_ERROR')
}

async function checkoutMovesRepositoryAndCard(): Promise<void> {
  const result = await fromView(`api.git.checkout(${JSON.stringify(repo)}, 'made-in-app')`)
  expect(result).toEqual({ success: true })
  expect(git(repo, 'branch', '--show-current')).toBe('made-in-app')
  await expect(projectGroup(handle.page, 'made-in-app')).toBeVisible()
}

async function worktreeRemovalDeletesIt(): Promise<void> {
  const worktree = join(e2eTempDir('terminator-e2e-wt-'), 'wt')
  git(repo, 'worktree', 'add', '-b', 'to-remove', worktree)
  expect(existsSync(worktree)).toBe(true)
  const result = await fromView(
    `api.git.removeWorktree(${JSON.stringify(repo)}, ${JSON.stringify(worktree)})`
  )
  expect(result).toEqual({ success: true })
  expect(existsSync(worktree)).toBe(false)
}

async function quickActionsOpenInsideView(): Promise<void> {
  await openNotesView()
  const frame = extensionFrame(handle, NOTES)
  if (!frame) throw new Error(`no frame for ${NOTES}`)
  // The frame's document must own focus for its listeners to see the key.
  await frame.evaluate(() => (document.body as HTMLElement).focus())
  await handle.page.keyboard.press('ControlOrMeta+p')
  const panel = quickActionsPanel(handle.page)
  await expect(panel).toBeVisible()
  // Pressed before focus has moved into the panel, Escape closed nothing.
  await expect(panel.locator(':focus')).toHaveCount(1)
  await handle.page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
}

async function listSessionsAndCloseAllEndEveryTerminal(): Promise<void> {
  const { page } = handle
  // A sidebar click closes an open extension panel and unloads its frame, so the view's calls
  // all run after it.
  await projectGroup(page, 'made-in-app').click()
  const open = await page.locator('.tab-bar__tab--session').count()
  await openNotesView()
  const listed = await fromView<Array<{ tabTitle: string }>>('api.terminal.listSessions()')
  expect(listed.map((s) => s.tabTitle)).toEqual(
    expect.arrayContaining(['Terminal 1', 'Terminal 2'])
  )
  const closed = await fromView<{ terminatedCount: number }>('api.terminal.closeAll()')
  expect(closed.terminatedCount).toBe(listed.length)
  expect(await fromView('api.terminal.listSessions()')).toEqual([])
  // Back on the branch, every tab that was open says its terminal ended.
  await projectGroup(page, 'made-in-app').click()
  const ended = page.locator('.tab-bar__tab--session', { hasText: '[exited]' })
  await expect(ended).toHaveCount(open)
  await expect(ended.locator('.tab-bar__state[aria-label="Exited"]')).toHaveCount(open)
}

async function theViewReadsTheWorkspace(): Promise<void> {
  await test.step(
    "an extension view's getActive names the workspace and branch on screen",
    getActiveNamesSelection
  )
  await test.step(
    "an extension view's readFile returns a file's text, or says it is missing",
    readFileReadsOrReportsMissing
  )
  await test.step(
    "an extension view's file watch reports changes until it is stopped",
    fileWatchReportsUntilStopped
  )
}

async function theViewActsOnTheRepository(): Promise<void> {
  await test.step(
    "an extension view's shell.exec runs git where it is allowed and nowhere else",
    shellExecIsConfined
  )
  await test.step(
    "an extension view's checkout moves the repository, and the card follows",
    checkoutMovesRepositoryAndCard
  )
  await test.step(
    "an extension view's worktree removal deletes the worktree",
    worktreeRemovalDeletesIt
  )
}

async function theViewReachesTheApp(): Promise<void> {
  await test.step(
    "⌘P (Ctrl+P off macOS) inside an extension's view opens Quick Actions",
    quickActionsOpenInsideView
  )
  await test.step(
    "an extension view's listSessions and closeAll see and end every terminal",
    listSessionsAndCloseAllEndEveryTerminal
  )
}

test('an extension view reads the workspace, acts on its repository and ends its terminals', async () => {
  await theViewReadsTheWorkspace()
  await theViewActsOnTheRepository()
  await theViewReachesTheApp()
})
