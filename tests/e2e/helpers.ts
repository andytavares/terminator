import { _electron as electron, ElectronApplication, Page, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { dirname, delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared e2e harness. Every spec launches the real Electron app in an isolated,
// throwaway profile (via Chromium's --user-data-dir, which Electron honours for
// app.getPath('userData')) so tests start from a clean store and never touch the
// developer's real Terminator data.

export interface AppHandle {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

/**
 * Directory holding this run's shared profile root, set by
 * `tests/e2e/global-setup.ts` before any worker starts. Every profile this
 * run creates lives under it, so `tests/e2e/global-teardown.ts` can delete
 * everything in one place after every worker has exited, and `closeApp`
 * never has to delete anything itself.
 */
function e2eRunRoot(): string {
  const root = process.env.TERMINATOR_E2E_RUN_ROOT
  if (!root) {
    throw new Error(
      'TERMINATOR_E2E_RUN_ROOT is not set — is global-setup wired in playwright.config.ts?'
    )
  }
  return root
}

function e2eProfileDir(): string {
  return mkdtempSync(join(e2eRunRoot(), 'profile-'))
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

/** The environment every e2e-launched Electron process gets. */
export function e2eEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PATH: `${CLAUDE_STUB_DIR}${delimiter}${process.env.PATH ?? ''}`,
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
 * after a close just works.
 */
// Inside the 30s hook timeout, so a launch that hangs fails with the app's own
// output instead of a bare "hook timeout exceeded" that says nothing about why.
const LAUNCH_DEADLINE_MS = 25_000

export async function launchApp(userDataDir: string = e2eProfileDir()): Promise<AppHandle> {
  const deadline = Date.now() + LAUNCH_DEADLINE_MS
  const remaining = () => Math.max(1, deadline - Date.now())
  const app = await electron.launch({
    // closeApp SIGKILLs an app that will not close, and macOS then shows a
    // modal "reopen windows?" alert on the next launch of the same bundle,
    // which blocks startup until firstWindow times out. The argument domain
    // turns that restore off for this process only.
    args: ['.', `--user-data-dir=${userDataDir}`, '-ApplePersistenceIgnoreState', 'YES'],
    env: e2eEnv(),
    timeout: remaining(),
  })
  const output: string[] = []
  const keep = (chunk: Buffer): void => {
    output.push(chunk.toString())
    if (output.length > 400) output.shift()
  }
  app.process().stdout?.on('data', keep)
  app.process().stderr?.on('data', keep)
  try {
    const page = await app.firstWindow({ timeout: remaining() })
    await page.waitForLoadState('domcontentloaded', { timeout: remaining() })
    await page.waitForSelector('.unified-sidebar', { timeout: remaining() })
    return { app, page, userDataDir }
  } catch (error) {
    await closeApp({ app, page: undefined as unknown as Page, userDataDir })
    throw new Error(
      `The app did not finish starting within ${LAUNCH_DEADLINE_MS / 1000}s: ${String(error)}\n` +
        `--- the app's own output ---\n${output.join('').slice(-6000) || '(nothing)'}`
    )
  }
}

// How long to wait for a graceful Electron shutdown before force-killing. A
// healthy app closes in well under a second; this is only a guard against a
// hang. Kept well below Playwright's 30s hook timeout so a stuck close can
// never blow the afterAll hook (which cascades into a worker-teardown timeout
// and fails the whole job as a non-test error).
const GRACEFUL_CLOSE_MS = 5000

export async function closeApp(handle: AppHandle | undefined): Promise<void> {
  if (!handle) return
  // Capture the OS process up front: once app.close() resolves, Playwright
  // tears down its internal handle and app.process() would throw.
  const proc = handle.app.process()
  // Bound the graceful close: a lingering PTY, git watcher, or extension host
  // can keep the process alive so app.close() never resolves. Race it against a
  // timeout, then force-kill whatever is left. The .catch keeps a close() that
  // loses the race from surfacing as an unhandled rejection after the SIGKILL.
  const closed = handle.app.close().catch(() => {})
  await Promise.race([
    closed,
    // A deadline, not a sleep: the race ends as soon as the app closes.
    // eslint-disable-next-line no-restricted-syntax
    new Promise<void>((resolve) => setTimeout(resolve, GRACEFUL_CLOSE_MS)),
  ])
  if (proc.exitCode === null && !proc.killed) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // Process already exited between the check and the kill — nothing to do.
    }
  }
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
  await page.waitForSelector('.dialog__title')
  await page.getByPlaceholder('My Workspace').fill(name)
  await page.getByPlaceholder('/path/to/folder').fill(folderPath)
  await page.click('.dialog__btn-primary')
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
  await expect(page.locator('.dialog__title')).toContainText('Create Branch')
  await page.getByPlaceholder('My branch').fill(projectName)
  await page.click('.dialog__btn-primary')
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
