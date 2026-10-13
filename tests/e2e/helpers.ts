import { _electron as electron, ElectronApplication, Locator, Page, expect } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { dirname, delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveIpcTrace, startIpcTrace } from './ipc-trace'
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

/**
 * A new directory under this run's root, for a spec's repository or folder.
 * `tests/e2e/global-teardown.ts` removes it with the root, whether the spec
 * passed or failed; one made in the OS temp directory stayed there.
 */
export function e2eTempDir(prefix: string): string {
  return mkdtempSync(join(e2eRunRoot(), prefix))
}

function e2eProfileDir(): string {
  return e2eTempDir('profile-')
}

/**
 * A stand-in `claude` binary that prints its argv and idles until killed.
 * Prepended to PATH by `launchApp` so a spec — however it drives the app's
 * terminals — can never start a real Claude Code agent.
 */
const CLAUDE_STUB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin')

/**
 * A minimal zsh config the app's terminals read instead of the developer's
 * real ~/.zshenv, ~/.zprofile and ~/.zshrc. Terminals are login shells
 * (`pty.spawn(opts.shell, ['-l'], …)`, src/main/terminal/pty-manager.ts) run
 * against whatever `terminal.defaultShell` resolves to, which defaults to
 * `process.env.SHELL` — on a developer machine that's zsh, and the
 * developer's own ~/.zshrc typically re-prepends `~/.local/bin` (where a
 * real `claude` lives) ahead of anything this harness puts on PATH. Pointing
 * ZDOTDIR here, at a shell that is forced to zsh, makes the fixture rc files
 * below the only ones a spawned terminal ever reads.
 */
const CLAUDE_STUB_ZDOTDIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'zdotdir')

/**
 * The app's PATH: `firstDirs`, then the `claude` stub, then the runner's own.
 * A spec that stands in for another program passes its folder as `env.PATH`
 * through this, so the `claude` stub stays ahead of any real one.
 */
export function e2ePath(...firstDirs: string[]): string {
  return [...firstDirs, CLAUDE_STUB_DIR, process.env.PATH ?? ''].join(delimiter)
}

/** The environment every e2e-launched Electron process gets. */
function e2eEnv(): Record<string, string> {
  // Electron's launch takes defined strings only; an unset variable is left out.
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
  return {
    ...Object.fromEntries(inherited),
    NODE_ENV: 'test',
    PATH: e2ePath(),
    // Pins terminal.defaultShell's process.env.SHELL fallback to zsh
    // regardless of the developer's or CI runner's own $SHELL (CI's macOS
    // runners default to bash), so ZDOTDIR below is guaranteed to apply.
    SHELL: '/bin/zsh',
    ZDOTDIR: CLAUDE_STUB_ZDOTDIR,
  }
}

/**
 * `userDataDir` relaunches onto an existing profile, for a spec that proves
 * something survives a restart; `closeApp` never deletes it, so relaunching
 * after a close just works. `env` adds to the app's environment, e.g. the
 * stub GitHub's (`tests/e2e/github-stub.ts`).
 */
// Inside the 30s hook timeout, so a launch that hangs fails with the app's own
// output instead of a bare "hook timeout exceeded" that says nothing about why.
// What a failed launch spends after it must fit in the rest:
// 25 s + 1 s reading the windows + 2.5 s to close + 1 s for a kill = 29.5 s.
const LAUNCH_DEADLINE_MS = 25_000
const WINDOW_STATE_READ_MS = 1000
const FAILED_LAUNCH_CLOSE_MS = 2500

/**
 * Extra Electron switches for this machine, space-separated in
 * E2E_ELECTRON_ARGS. A Linux runner sets `--no-sandbox`: Chromium's sandbox
 * needs a setuid helper or user namespaces the runner does not grant.
 */
function machineArgs(): string[] {
  return (process.env.E2E_ELECTRON_ARGS ?? '').split(' ').filter(Boolean)
}

/**
 * Starts Electron on the profile, with this machine's switches and the e2e
 * environment beneath `env`.
 */
function startElectron(
  userDataDir: string,
  env: Record<string, string>,
  timeout: number
): Promise<ElectronApplication> {
  return electron.launch({
    // closeApp SIGKILLs an app that will not close, and macOS then shows a
    // modal "reopen windows?" alert on the next launch of the same bundle,
    // which blocks startup until firstWindow times out. The argument domain
    // turns that restore off for this process only.
    args: [
      '.',
      ...machineArgs(),
      `--user-data-dir=${userDataDir}`,
      '-ApplePersistenceIgnoreState',
      'YES',
    ],
    env: { ...e2eEnv(), ...env },
    timeout,
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

/** The first window, once it shows the sidebar, within what is left of the launch. */
async function firstReadyWindow(app: ElectronApplication, remaining: () => number): Promise<Page> {
  await startIpcTrace(app)
  const page = await app.firstWindow({ timeout: remaining() })
  await page.waitForLoadState('domcontentloaded', { timeout: remaining() })
  await page.waitForSelector('.unified-sidebar', { timeout: remaining() })
  await moveWindowOffPointer(app)
  return page
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

export async function launchApp(
  userDataDir: string = e2eProfileDir(),
  env: Record<string, string> = {}
): Promise<AppHandle> {
  const deadline = Date.now() + LAUNCH_DEADLINE_MS
  const marker = launchMarker()
  const remaining = () => Math.max(1, deadline - Date.now())
  const app = await startElectron(userDataDir, { ...env, ...marker.env }, remaining())
  const output = keepOutput(app)
  try {
    const page = await firstReadyWindow(app, remaining)
    return { app, page, userDataDir, launchId: marker.launchId }
  } catch (error) {
    throw await launchFailure(app, output, error)
  }
}

/** Resolves after `ms`: the losing side of a race that bounds a wait. */
function deadline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // A deadline, not a sleep: whatever it races ends the wait as soon as it settles.
    // eslint-disable-next-line no-restricted-syntax
    setTimeout(resolve, ms)
  })
}

/**
 * What each window was doing when a launch gave up: the document it was on,
 * whether that was still loading, and whether its renderer had gone. A main
 * process that no longer answers says so instead, so a failed launch tells a
 * hung main, a dead renderer and a page that never loaded apart.
 */
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
  const unanswered = deadline(WINDOW_STATE_READ_MS).then(() => '(the main process did not answer)')
  return Promise.race([read, unanswered])
}

/**
 * Moves the app's window so the X server's own pointer is outside it, on Linux.
 *
 * Chromium on X11 synthesizes a mousemove at the real pointer whenever a view
 * under it is added, removed or resized, as an extension view is when its
 * extension activates. Xvfb parks the pointer at the centre of the screen,
 * inside the window, and that move carries no pressed button, so it lands
 * between Playwright's mouse down and mouse move and Chromium abandons the drag:
 * `dragTo` returned and nothing was dropped. macOS does not synthesize it.
 */
async function moveWindowOffPointer(app: ElectronApplication): Promise<void> {
  if (process.platform !== 'linux') return
  await app.evaluate(({ BrowserWindow, screen }) => {
    const pointer = screen.getCursorScreenPoint()
    for (const window of BrowserWindow.getAllWindows()) {
      window.setPosition(window.getBounds().x, pointer.y + 1)
    }
  })
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

/**
 * Whether the process has ended. `killed` is not it: Node sets that when the
 * signal is sent, not when the process exits
 * (https://nodejs.org/api/child_process.html#subprocesskilled).
 */
function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null
}

/** Settles on the process's 'exit' event (https://nodejs.org/api/child_process.html#event-exit). */
function exited(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (hasExited(proc)) resolve()
    else proc.once('exit', () => resolve())
  })
}

/**
 * Quits the app and returns once its process has exited, so it can never
 * overlap the next launch. A lingering PTY, git watcher or extension host can
 * keep app.close() from ever resolving, so the close gets `graceMs` before the
 * process is killed. The .catch keeps a close() that loses the race from
 * surfacing as an unhandled rejection after the SIGKILL.
 */
async function stopApp(app: ElectronApplication, graceMs: number): Promise<void> {
  // Taken up front: once app.close() resolves, app.process() throws.
  const proc = app.process()
  await Promise.race([app.close().catch(() => {}), deadline(graceMs)])
  if (hasExited(proc)) return
  proc.kill('SIGKILL')
  await Promise.race([exited(proc), deadline(KILLED_EXIT_MS)])
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
 * auto-create-branch-project path.
 */
export async function createWorkspace(page: Page, name: string, folderPath: string): Promise<void> {
  await page.click('.sidebar-header__add')
  await page.waitForSelector('.tmui-dialog__title')
  await page.getByPlaceholder('My Workspace').fill(name)
  await page.getByPlaceholder('/path/to/folder').fill(folderPath)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(workspaceRow(page, name)).toBeVisible()
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
  await page.getByRole('textbox', { name: 'Terminal input' }).first().waitFor({ timeout: 15000 })
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

/**
 * Runs a Quick Action the way an operator finds one they have no key for: the
 * band's Quick actions button, `/`, its name, then its row. The panel records
 * the run in `quickActions.usage`, which is how the coverage map counts it.
 */
export async function runQuickAction(page: Page, label: string): Promise<void> {
  await page.locator('.app-band__entry[aria-label="Quick actions (⌘P)"]').click()
  const panel = quickActionsPanel(page)
  await expect(panel).toBeFocused({ timeout: 10000 })
  await page.keyboard.press('/')
  await page.keyboard.type(label)
  await panel
    .locator('.qa-row')
    .filter({ has: page.locator('.qa-row__label', { hasText: exactly(label) }) })
    .first()
    .click()
  await expect(panel).toBeHidden({ timeout: 15000 })
}

/** Opens Settings with ⌘, (Ctrl+, off macOS) on the named section. */
export async function openSettings(page: Page, section: string): Promise<void> {
  if (!(await page.locator('.settings-panel').isVisible())) {
    await page.keyboard.press('ControlOrMeta+,')
  }
  await expect(page.locator('.settings-panel')).toBeVisible()
  await page.locator('.settings-panel__nav-item', { hasText: section }).click()
}

/** Closes Settings with its close button. */
export async function closeSettings(page: Page): Promise<void> {
  await page.locator('.settings-panel__close').click()
  await expect(page.locator('.settings-panel')).toBeHidden()
}

/**
 * Runs `script` inside the first extension view whose URL contains `urlPart`:
 * a WebContentsView of its own, which the page cannot reach.
 */
export function inExtensionView<T>(handle: AppHandle, urlPart: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { part, source }) => {
      const view = webContents
        .getAllWebContents()
        .find((contents) => !contents.isDestroyed() && contents.getURL().includes(part))
      if (!view) throw new Error(`no extension view loaded for ${part}`)
      return view.executeJavaScript(source) as Promise<unknown>
    },
    { part: urlPart, source: script }
  ) as Promise<T>
}

/**
 * The rows every open terminal shows, one terminal after another, read from
 * xterm's buffer. Under the WebGL renderer the terminal is a canvas and the
 * DOM holds none of its text. For a row's place on screen, use `terminalRowsIn`.
 */
export function terminalRows(page: Page): Promise<string[]> {
  return page.evaluate(() => window.terminatorE2E!.terminalRows())
}

/** The screen (`.xterm-screen`) of the first terminal that is on screen. */
export function visibleTerminalScreen(page: Page): Locator {
  return page.locator('.xterm-screen').filter({ visible: true }).first()
}

/** The rows of the one terminal drawn in `screen`, a pane's `.xterm-screen`, top to bottom. */
export function terminalRowsIn(screen: Locator): Promise<string[]> {
  return screen.evaluate((element) => window.terminatorE2E!.terminalRowsIn(element))
}
