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
import type { ElectronAPI as ViewElectronAPI } from '../../packages/extension-sdk/types/renderer'
import { extensionFrame, findExtensionFrame } from './extension-page'

declare global {
  interface Window {
    /** What Notes' view heard from fs.onChanged since the spec last cleared it. */
    __fsEvents: Array<{ projectRoot: string }>
  }
}

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
  const button = handle.page.locator('button[aria-label="Notes"]')
  // The band draws its buttons before any panel it restores; wait for it before reading the panel.
  await expect(button).toBeVisible()
  if ((await panel.count()) === 0) await button.click()
  await expect(panel).toHaveCount(1)
  await expect
    .poll(() => inExtensionView<boolean>(handle, NOTES, '!!window.electronAPI').catch(() => false))
    .toBe(true)
}

/** Runs `call` in Notes' view, with the view's window.electronAPI and `arg`. */
async function fromView<T, Arg = undefined>(
  call: (api: ViewElectronAPI, arg: Arg) => T | Promise<T>,
  arg?: Arg
): Promise<T> {
  const frame = await findExtensionFrame(handle, NOTES)
  const api = await frame.evaluateHandle(() => window.electronAPI as unknown as ViewElectronAPI)
  // Playwright types the argument as Unboxed<Arg>, which is Arg for the plain values sent here.
  return api.evaluate<T, Arg>(call as never, arg as Arg)
}

async function getActiveNamesSelection(): Promise<void> {
  await openNotesView()
  const active = await fromView((api) => api.workspace.getActive())
  const { workspaces } = await handle.page.evaluate(() => window.electronAPI.workspace.list())
  expect(active.workspaceId).toBe(workspaces.find((w) => w.name === WS)!.id)
  // A repository's root is git's top level, which resolves the temp dir's symlink.
  expect(active.repoRoot).toBe(realpathSync(repo))
}

async function readFileReadsOrReportsMissing(): Promise<void> {
  const file = join(repo, 'read-me.md')
  writeFileSync(file, '# Template\n')
  const readFile = (api: ViewElectronAPI, path: string) => api.fs.readFile(path)
  expect(await fromView(readFile, file)).toEqual({ content: '# Template\n' })
  expect(await fromView(readFile, file + '.gone')).toEqual({ error: 'FILE_NOT_FOUND' })
}

/** Writes in each directory again on every look, until the view is told about `expected`: macOS
 * arms a watch a moment after it starts, and a change made before that has no event. */
async function writeUntilViewIsTold(directories: string[], expected: string): Promise<string[]> {
  const roots = () => fromView(() => window.__fsEvents.map((e) => e.projectRoot))
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
  await fromView((api, directory) => {
    window.__fsEvents = []
    api.fs.onChanged((e) => window.__fsEvents.push(e))
    return api.fs.watchStart(directory)
  }, watched)
  await writeUntilViewIsTold([watched], watched)
  // The view asked, so the view is told: the window, which did not, hears nothing.
  expect(await handle.page.evaluate('window.__windowFsEvents')).toEqual([])
  const watchStop = (api: ViewElectronAPI) => api.fs.watchStop()
  expect(await fromView(watchStop)).toEqual({ ok: true })
  await fromView((api, directory) => {
    window.__fsEvents = []
    return api.fs.watchStart(directory)
  }, other)
  expect(await writeUntilViewIsTold([watched, other], other)).not.toContain(watched)
  await fromView(watchStop)
}

async function shellExecIsConfined(): Promise<void> {
  type ExecOptions = Parameters<ViewElectronAPI['shell']['exec']>[0]
  const exec = (api: ViewElectronAPI, options: ExecOptions) => api.shell.exec(options)
  const ran = await fromView(exec, {
    command: 'git',
    args: ['branch', '--show-current'],
    cwd: repo,
  })
  expect(ran).toMatchObject({ exitCode: 0, stdout: 'main\n' })
  const outside = await fromView(exec, {
    command: 'git',
    args: ['status'],
    cwd: tmpdir(),
    workspaceRoot: repo,
  })
  expect(outside).toEqual({ error: 'CWD_OUT_OF_SCOPE' })
  // The type allows only git and gh; the handler must refuse the rest on its own.
  const notGit = await fromView(exec, { command: 'ls' as 'git', args: [], cwd: repo })
  expect(notGit).toMatchObject({ error: 'VALIDATION_ERROR' })
}

async function checkoutMovesRepositoryAndCard(): Promise<void> {
  const result = await fromView((api, root) => api.git.checkout(root, 'made-in-app'), repo)
  expect(result).toEqual({ success: true })
  expect(git(repo, 'branch', '--show-current')).toBe('made-in-app')
  await expect(projectGroup(handle.page, 'made-in-app')).toBeVisible()
}

async function worktreeRemovalDeletesIt(): Promise<void> {
  const worktree = join(e2eTempDir('terminator-e2e-wt-'), 'wt')
  git(repo, 'worktree', 'add', '-b', 'to-remove', worktree)
  expect(existsSync(worktree)).toBe(true)
  const result = await fromView((api, [root, path]) => api.git.removeWorktree(root, path), [
    repo,
    worktree,
  ] as const)
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
  const listSessions = (api: ViewElectronAPI) => api.terminal.listSessions()
  const listed = await fromView(listSessions)
  expect(listed.map((s) => s.tabTitle)).toEqual(
    expect.arrayContaining(['Terminal 1', 'Terminal 2'])
  )
  const closed = await fromView((api) => api.terminal.closeAll())
  expect(closed.terminatedCount).toBe(listed.length)
  expect(await fromView(listSessions)).toEqual([])
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

test(
  'an extension view reads the workspace, acts on its repository and ends its terminals',
  { tag: '@mac' },
  async () => {
    await theViewReadsTheWorkspace()
    await theViewActsOnTheRepository()
    await theViewReachesTheApp()
  }
)
