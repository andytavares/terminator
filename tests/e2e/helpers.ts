import {
  _electron as electron,
  ElectronApplication,
  Frame,
  Locator,
  Page,
  expect,
} from '@playwright/test'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sealedAppEnvironment } from './e2e-environment'
import { saveIpcTrace, startIpcTrace } from './ipc-trace'
import { orOnHang } from '../support/hang-bound'
import { E2E_LAUNCH_HANG_MS } from '../support/bounds'
import { appProcessTree, expectNoProcessesLeft, launchMarker } from './leftover-processes'

// Shared e2e harness. Every spec launches the real Electron app in an isolated,
// throwaway profile (via Chromium's --user-data-dir, which Electron honours for
// app.getPath('userData')) so tests start from a clean store and never touch the
// developer's real Terminator data.

export interface AppHandle {
  app: ElectronApplication
  page: Page
  userDataDir: string
  /** The marker in this launch's environment; closeApp finds what it left by it. */
  launchId: string
}

/**
 * Directory holding this run's shared profile root, set by
 * `tests/e2e/global-setup.ts` before any worker starts. Every profile this
 * run creates lives under it, so `tests/e2e/global-teardown.ts` can delete
 * everything in one place after every worker has exited, and `closeApp`
 * never has to delete anything itself.
 */
export function e2eRunRoot(): string {
  const root = process.env.TERMINATOR_E2E_RUN_ROOT
  if (!root) {
    throw new Error(
      'TERMINATOR_E2E_RUN_ROOT is not set — is global-setup wired in playwright.config.ts?'
    )
  }
  return root
}

/** A new directory under this run's root, for a spec's repository or folder.
 * `tests/e2e/global-teardown.ts` removes it with the root, whether the spec
 * passed or failed; one made in the OS temp directory stayed there. */
export function e2eTempDir(prefix: string): string {
  return mkdtempSync(join(e2eRunRoot(), prefix))
}

function e2eProfileDir(): string {
  return e2eTempDir('profile-')
}

/** The home directory of each profile's app, kept so a relaunch onto the same profile finds
 * what the first launch wrote under `~/.claude`. */
const homesByProfile = new Map<string, string>()

/** The environment every e2e-launched Electron process gets: sealed, with a home of its own
 * under this run's root, so the app's writes to `~/.claude/settings.json` never reach the
 * developer's and parallel workers never race on one file (ADR 123). */
function e2eEnv(userDataDir: string): Record<string, string> {
  let home = homesByProfile.get(userDataDir)
  if (home === undefined) {
    home = e2eTempDir('home-')
    homesByProfile.set(userDataDir, home)
  }
  return sealedAppEnvironment({ home, tmpdir: e2eTempDir('tmp-') })
}

/**
 * `userDataDir` relaunches onto an existing profile, for a spec that proves
 * something survives a restart; `closeApp` never deletes it, so relaunching
 * after a close just works. `env` adds to the app's environment, e.g. the
 * stub GitHub's (`tests/e2e/github-stub.ts`).
 */
// Bounds a launch that hangs so it fails with the app's own output and its windows' state,
// instead of a bare test timeout that says nothing about why. A hang bound, far above a slow
// start (25 s once failed two CI launches that were only slow); what a failed launch spends
// after it: 1 s reading the windows + 2.5 s to close + 1 s for a kill, inside the test's bound.
const LAUNCH_DEADLINE_MS = E2E_LAUNCH_HANG_MS
const WINDOW_STATE_READ_MS = 1000
const FAILED_LAUNCH_CLOSE_MS = 2500

/** Starts Electron on the profile, with the e2e environment beneath `env`. */
function startElectron(
  userDataDir: string,
  env: Record<string, string>
): Promise<ElectronApplication> {
  return electron.launch({
    // closeApp SIGKILLs an app that will not close, and macOS then shows a
    // modal "reopen windows?" alert on the next launch of the same bundle,
    // which blocks startup until firstWindow times out. The argument domain
    // turns that restore off for this process only.
    args: ['.', `--user-data-dir=${userDataDir}`, '-ApplePersistenceIgnoreState', 'YES'],
    env: { ...e2eEnv(userDataDir), ...env },
  })
}

/** The app's most recent output, stdout and stderr, kept for a failed launch to report. */
function keepOutput(app: ElectronApplication): string[] {
  const output: string[] = []
  const keep = (chunk: Buffer): void => {
    output.push(chunk.toString())
    if (output.length > 400) output.shift()
  }
  app.process().stdout?.on('data', keep)
  app.process().stderr?.on('data', keep)
  return output
}

/** The first window, once it has drawn, holds Chromium focus and shows the sidebar. */
async function firstReadyWindow(app: ElectronApplication): Promise<Page> {
  await startIpcTrace(app)
  const page = await app.firstWindow()
  const windowId = String(await (await app.browserWindow(page)).evaluate((window) => window.id))
  await Promise.all([
    untilAnnounced(app, 'drawn', windowId),
    untilAnnounced(app, 'focused', windowId),
  ])
  await expect(page.locator('.unified-sidebar')).toBeVisible()
  return page
}

/** Settles as `work` does, or fails once `ms` has passed: the launch's diagnostic bound. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return orOnHang(work, ms, () => Promise.reject(new Error(`no answer within ${ms / 1000}s`)))
}

/** Stops an app that did not finish starting, and says what its windows were doing and what it printed. */
async function launchFailure(
  app: ElectronApplication,
  output: string[],
  error: unknown
): Promise<Error> {
  const windows = await windowStates(app)
  await stopApp(app, FAILED_LAUNCH_CLOSE_MS)
  return new Error(
    `The app did not finish starting within ${LAUNCH_DEADLINE_MS / 1000}s: ${String(error)}\n` +
      `--- its windows when it gave up ---\n${windows}\n` +
      `--- the app's own output ---\n${output.join('').slice(-6000) || '(nothing)'}`,
    { cause: error }
  )
}

/** Each extension frame's focus emulation, keyed by the frame, settled once it is on. */
const frameFocusEmulation = new WeakMap<Frame, Promise<void>>()

/** Makes `frame` behave as if its window had focus, as Playwright already does for the page.
 * An extension frame runs in its own process, which Playwright leaves out: while the window is not
 * the active application (a CI runner's usually is not) its fields are never focused or blurred,
 * so a setting saved on blur is never saved and a key lands nowhere.
 * https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled */
function emulateFrameFocus(page: Page, frame: Frame): Promise<void> {
  const enabled = page
    .context()
    .newCDPSession(frame)
    .then((session) => session.send('Emulation.setFocusEmulationEnabled', { enabled: true }))
    .then(() => undefined)
  frameFocusEmulation.set(frame, enabled)
  return enabled
}

/** Resolves once `frame` has focus emulation, turning it on if no navigation has yet. */
export function frameFocusEmulated(page: Page, frame: Frame): Promise<void> {
  const pending = frameFocusEmulation.get(frame)
  // A try made while the frame was still navigating can fail; the frame is settled by now.
  return pending
    ? pending.catch(() => emulateFrameFocus(page, frame))
    : emulateFrameFocus(page, frame)
}

/** Every extension frame gets focus emulation as it loads, a reload included. */
function emulateFocusInExtensionFrames(page: Page): void {
  page.on('framenavigated', (frame) => {
    if (frame.url().startsWith('ext://')) emulateFrameFocus(page, frame).catch(() => undefined)
  })
}

const POINTER_ACTIONS = [
  'click',
  'dblclick',
  'hover',
  'check',
  'uncheck',
  'setChecked',
  'tap',
  'dragTo',
] as const
let drawsBeforePointerActions = false

/** Makes every locator's pointer action wait for the window to draw first (see `untilDrawn`).
 * The app's windows are hidden in an e2e run, and on CI a hidden window drew late: a click on
 * Task Vault's sidebar went to the frame drawn before it and did nothing. */
function drawBeforePointerActions(page: Page): void {
  if (drawsBeforePointerActions) return
  drawsBeforePointerActions = true
  const prototype = Object.getPrototypeOf(page.locator('body')) as Record<string, unknown>
  for (const name of POINTER_ACTIONS) {
    const act = prototype[name] as (this: Locator, ...args: unknown[]) => Promise<unknown>
    prototype[name] = async function (this: Locator, ...args: unknown[]) {
      await untilDrawn(this.page())
      return act.apply(this, args)
    }
  }
}

/** Home hides the branch tree by default (`ui.hideSidebarOnHome`); a spec that clicks the
 * sidebar from Home would find nothing there. A new profile is seeded with the tree shown,
 * unless the spec is about the default and asks for it. */
export interface LaunchOptions {
  hideSidebarOnHome?: boolean
}

/** electron-store's file for the settings store (`name: 'settings'`); `global` is merged over the defaults. */
function seedSidebarShownOnHome(userDataDir: string): void {
  const file = join(userDataDir, 'settings.json')
  if (existsSync(file)) return
  writeFileSync(file, JSON.stringify({ global: { ui: { hideSidebarOnHome: false } } }))
}

export async function launchApp(
  userDataDir: string = e2eProfileDir(),
  env: Record<string, string> = {},
  options: LaunchOptions = {}
): Promise<AppHandle> {
  if (options.hideSidebarOnHome !== true) seedSidebarShownOnHome(userDataDir)
  const marker = launchMarker()
  const app = await startElectron(userDataDir, { ...env, ...marker.env })
  const output = keepOutput(app)
  try {
    const page = await within(LAUNCH_DEADLINE_MS, firstReadyWindow(app))
    emulateFocusInExtensionFrames(page)
    drawBeforePointerActions(page)
    return { app, page, userDataDir, launchId: marker.launchId }
  } catch (error) {
    throw await launchFailure(app, output, error)
  }
}

/** Resolves once the main process announces `kind` for `subject` (src/main/e2e-readiness.ts):
 * a window's id for `drawn` and `focused`, `<extension id>:<view>` for `ready`. */
export function untilAnnounced(
  app: ElectronApplication,
  kind: 'drawn' | 'focused' | 'ready',
  subject: string
): Promise<void> {
  return app.evaluate(
    (_electron, key) =>
      (
        globalThis as unknown as {
          __terminatorE2E: { whenAnnounced(kind: string, subject: string): Promise<void> }
        }
      ).__terminatorE2E.whenAnnounced(key.kind, key.subject),
    { kind, subject }
  )
}

/** What each window was doing when a launch gave up (its document, still loading, renderer
 * gone), or that main no longer answers: so a hung main, a dead renderer and a page that
 * never loaded can be told apart. */
async function windowStates(app: ElectronApplication): Promise<string> {
  const read = app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => {
        const contents = window.webContents
        return JSON.stringify({
          url: contents.getURL(),
          loading: contents.isLoading(),
          crashed: contents.isCrashed(),
          visible: window.isVisible(),
        })
      })
    )
    .then((states) => states.join('\n') || '(no windows)')
    .catch((error: unknown) => `(could not ask the main process: ${String(error)})`)
  return orOnHang(read, WINDOW_STATE_READ_MS, () => '(the main process did not answer)')
}

// How long to wait for a graceful Electron shutdown before force-killing. A
// healthy app closes in well under a second; this is only a guard against a
// hang. Kept well below Playwright's 30s hook timeout so a stuck close can
// never blow the afterAll hook (which cascades into a worker-teardown timeout
// and fails the whole job as a non-test error).
const GRACEFUL_CLOSE_MS = 5000
// SIGKILL cannot be caught, so the process is gone almost at once; a second is
// only a guard against a kernel that never reaps it.
const KILLED_EXIT_MS = 1000

/** Whether the process has ended. `killed` is not it: Node sets that when the
 * signal is sent, not when the process exits
 * (https://nodejs.org/api/child_process.html#subprocesskilled). */
function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null
}

/** Settles on the process's 'exit' event (https://nodejs.org/api/child_process.html#event-exit). */
function processExited(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (hasExited(proc)) resolve()
    else proc.once('exit', () => resolve())
  })
}

/** Quits the app and returns once its process has exited. A lingering PTY, watcher or host
 * can keep app.close() from resolving, so it gets `graceMs` before a kill; the .catch keeps
 * a close() that loses that race from becoming an unhandled rejection. */
async function stopApp(app: ElectronApplication, graceMs: number): Promise<void> {
  // Taken up front: once app.close() resolves, app.process() throws.
  const proc = app.process()
  await orOnHang(
    app.close().catch(() => {}),
    graceMs,
    () => undefined
  )
  if (hasExited(proc)) return
  proc.kill('SIGKILL')
  await orOnHang(processExited(proc), KILLED_EXIT_MS, () => undefined)
  if (!hasExited(proc)) {
    throw new Error(
      `The app (pid ${proc.pid}) was still running ${KILLED_EXIT_MS} ms after SIGKILL`
    )
  }
}

export async function closeApp(
  handle: Pick<AppHandle, 'app' | 'userDataDir' | 'launchId'> | undefined
): Promise<void> {
  if (!handle) return
  await saveIpcTrace(handle.app)
  const started = appProcessTree(handle.app.process().pid ?? -1)
  await stopApp(handle.app, GRACEFUL_CLOSE_MS)
  await expectNoProcessesLeft(handle.launchId, started)
  // The profile is not deleted here. It is still being written to as the app
  // dies — a terminal's scrollback, an extension's state, a transcript — and
  // the directory disappearing out from under those raced the delete: a spec
  // that ran a real agent used to fail in teardown as ENOTEMPTY, which read as
  // a broken test rather than as tidying up too eagerly. Every profile lives
  // under this run's shared root (see `e2eRunRoot`), which
  // `tests/e2e/global-teardown.ts` removes once every worker has exited, so
  // cleanup can never fail a test.
}

/**
 * Create a workspace via the sidebar dialog. `folderPath` is required by the
 * schema; pass a non-git directory (e.g. the test's userDataDir) to avoid the
 * auto-create-branch-project path. A git checkout gets its first branch card after the app has
 * asked git about it, which is after the workspace's header shows, so this returns once the card
 * is there too: a caller that acts on `main` straight away is not racing those git calls.
 */
export async function createWorkspace(page: Page, name: string, folderPath: string): Promise<void> {
  await page.click('.sidebar-header__add')
  await expect(page.locator('.tmui-dialog__title')).toBeVisible()
  await page.getByPlaceholder('My Workspace').fill(name)
  await page.getByPlaceholder('/path/to/folder').fill(folderPath)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(workspaceRow(page, name)).toBeVisible()
  const branch = checkedOutBranchOf(folderPath)
  if (branch !== null) await expectCheckoutCard(page, folderPath, branch)
}

/** The checkout's branch card, or a failure that says what the app answers about the folder now.
 * The app makes the card when git:is-repo and git:current-branch answer; when git cannot, the
 * dialog says so and takes the workspace back, so a missing card is a bare timeout otherwise. */
async function expectCheckoutCard(page: Page, folderPath: string, branch: string): Promise<void> {
  try {
    await expect(projectGroup(page, branch)).toBeVisible()
  } catch (error) {
    const answer = await page.evaluate((path) => window.electronAPI.git.isRepo(path), folderPath)
    throw new Error(
      `${folderPath} is a git checkout on ${branch}, but no "${branch}" card appeared; git:is-repo now answers ${JSON.stringify(answer)}`,
      { cause: error }
    )
  }
}

/** The branch a folder has checked out, or null when it is not a git checkout. */
function checkedOutBranchOf(folderPath: string): string | null {
  if (!existsSync(join(folderPath, '.git'))) return null
  const result = spawnSync('git', ['-C', folderPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
  })
  const branch = result.stdout.trim()
  return result.status === 0 && branch !== '' && branch !== 'HEAD' ? branch : null
}

/**
 * A repo's header in the sidebar. The `.ws-row` this replaced was an
 * always-visible "new branch" strip closing each repo's run; with that gone the
 * header is the only thing standing for a repo, and it hosts what the row did.
 */
export function workspaceRow(page: Page, name: string) {
  return page
    .locator('.repo-header')
    .filter({ has: page.locator('.repo-header__name', { hasText: name }) })
}

/**
 * A branch's row. Every branch is a row whether or not a terminal is open on
 * it, so this is present as soon as the branch exists.
 */
export function projectGroup(page: Page, projectName: string) {
  return page
    .locator('.branch-row')
    .filter({ has: page.locator('.branch-row__name', { hasText: projectName }) })
    .last()
}

/**
 * Add a plain (non-git) branch to a repo and select it. Selecting a branch is
 * what sets the active repo, which several panels require. Returns once the
 * branch has a terminal.
 */
export async function addAndSelectProject(
  page: Page,
  workspaceName: string,
  projectName: string
): Promise<void> {
  await workspaceRow(page, workspaceName).hover()
  await workspaceRow(page, workspaceName)
    .locator(`.repo-header__action[aria-label="New branch in ${workspaceName}"]`)
    .click()
  await expect(page.locator('.tmui-dialog__title')).toContainText('Create Branch')
  await page.getByPlaceholder('My branch').fill(projectName)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  const row = projectGroup(page, projectName)
  await expect(row).toBeVisible()
  // Clicking the row selects the branch; the app's auto-open effect gives it
  // its first terminal, which now shows in the tab bar rather than the sidebar.
  await row.click()
  // Session tabs carry no role; the mounted terminal's input is the accessible sign a session opened.
  await page.getByRole('textbox', { name: 'Terminal input' }).first().waitFor()
}

/** Re-select an existing branch. */
export async function selectProject(
  page: Page,
  workspaceName: string,
  projectName: string
): Promise<void> {
  await projectGroup(page, projectName).click()
}

/** The Quick Actions panel. */
export function quickActionsPanel(page: Page) {
  return page.getByRole('dialog', { name: 'Quick actions' })
}

const exactly = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

/** Runs a Quick Action the way an operator finds one they have no key for: the
 * band's Quick actions button, `/`, its name, then its row. The panel records
 * the run in `quickActions.usage`, which is how the coverage map counts it. */
export async function runQuickActionFromPanel(page: Page, label: string): Promise<void> {
  await page.locator('.app-band__entry[aria-label="Quick actions (⌘P)"]').click()
  const panel = quickActionsPanel(page)
  await expect(panel.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('/')
  await page.keyboard.type(label)
  const row = panel
    .locator('.qa-row')
    .filter({ has: page.locator('.qa-row__label', { hasText: exactly(label) }) })
    .first()
  // The filtered row is new, and the panel may sit over an extension frame.
  await expect(row).toBeVisible()
  await untilDrawn(page)
  await row.click()
  await expect(panel).toBeHidden()
}

/** Resolves once the window has drawn what the page shows. The browser routes a click by the
 * last frame it drew, so a click on a dialog that is in the DOM but not yet on screen goes to
 * whatever was drawn there before, such as an extension frame. A screenshot makes the browser
 * draw (and update its hit-testing) before it returns. */
export async function untilDrawn(page: Page): Promise<void> {
  await page.screenshot({ clip: { x: 0, y: 0, width: 1, height: 1 } })
}

/** Runs `action`, which opens a confirm dialog, and accepts that dialog; settles when both have. */
export async function acceptingDialog(page: Page, action: () => Promise<void>): Promise<void> {
  await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.accept()), action()])
}

/** Opens Settings with ⌘, (Ctrl+, off macOS) on the named section. */
export async function openSettingsSection(page: Page, section: string): Promise<void> {
  if (!(await page.locator('.settings-panel').isVisible())) {
    await page.keyboard.press('ControlOrMeta+,')
  }
  await expect(page.locator('.settings-panel')).toBeVisible()
  await untilDrawn(page)
  await page.locator('.settings-panel__nav-item', { hasText: section }).click()
}

/** Closes Settings with its close button. */
export async function closeSettingsPanel(page: Page): Promise<void> {
  await page.locator('.settings-panel__close').click()
  await expect(page.locator('.settings-panel')).toBeHidden()
}

/** Runs `script` inside the first extension frame whose URL contains `urlPart`. */
export function inExtensionView<T>(handle: AppHandle, urlPart: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { part, source }) => {
      const win = webContents.getAllWebContents().find((contents) => !contents.isDestroyed())
      const frame = win?.mainFrame.frames.find(
        (f) => f.url.startsWith('ext://') && f.url.includes(part)
      )
      if (!frame) throw new Error(`no extension frame loaded for ${part}`)
      return frame.executeJavaScript(source) as Promise<unknown>
    },
    { part: urlPart, source: script }
  ) as Promise<T>
}

/** The rows every open terminal shows, one terminal after another, read from
 * xterm's buffer. Under the WebGL renderer the terminal is a canvas and the
 * DOM holds none of its text. For a row's place on screen, use `terminalRowsIn`. */
export function readTerminalRows(page: Page): Promise<string[]> {
  return page.evaluate(() => window.terminatorE2E!.terminalRows())
}

/** The screen (`.xterm-screen`) of the first terminal that is on screen. */
export function visibleTerminalScreen(page: Page): Locator {
  return page.locator('.xterm-screen').filter({ visible: true }).first()
}

/** The rows of the one terminal drawn in `screen`, a pane's `.xterm-screen`, top to bottom. */
export function readTerminalRowsIn(screen: Locator): Promise<string[]> {
  return screen.evaluate((element) => window.terminatorE2E!.terminalRowsIn(element))
}
