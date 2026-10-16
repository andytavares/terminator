import { expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { extensionPage, type ExtensionView } from './extension-page'
import { git } from './foundry-harness'
import { createWorkspace, workspaceRow, type AppHandle } from './helpers'

// Git Integration specs' setup: a repository whose remote is a local bare one (which the stub
// GitHub serves pull requests from), and each view, a frame in the main window, as a view to drive.

export { git }

export interface RepoWithRemote {
  /** The working checkout the app opens. */
  repo: string
  /** Its `origin`, a bare repository. */
  bare: string
}

/** A checkout on `main` with one commit, pushed to a bare `origin`. */
export function makeRepoWithRemote(prefix: string): RepoWithRemote {
  const bare = mkdtempSync(join(tmpdir(), `${prefix}-origin-`))
  const repo = mkdtempSync(join(tmpdir(), `${prefix}-`))
  git(bare, 'init', '--bare', '-b', 'main')
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  git(repo, 'config', 'user.name', 'E2E')
  git(repo, 'remote', 'add', 'origin', bare)
  writeFile(repo, 'README.md', '# widgets\n')
  writeFile(repo, 'src/math.ts', 'export function add(a: number, b: number) {\n  return a + b\n}\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'push', '--quiet', '-u', 'origin', 'main')
  return { repo, bare }
}

export function writeFile(repo: string, path: string, content: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), content)
}

/** Commits `files` on a new branch off main and pushes it; the checkout goes back to main. */
export function pushBranchToOrigin(
  repo: string,
  branch: string,
  files: Record<string, string>
): void {
  git(repo, 'checkout', '--quiet', '-b', branch, 'main')
  for (const [path, content] of Object.entries(files)) writeFile(repo, path, content)
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', `${branch}: change ${Object.keys(files).join(', ')}`)
  git(repo, 'push', '--quiet', 'origin', branch)
  git(repo, 'checkout', '--quiet', 'main')
}

/** Opens `repo` as a workspace and selects its branch, so its project tabs exist. */
export async function openRepo(handle: AppHandle, name: string, repo: string): Promise<void> {
  await createWorkspace(handle.page, name, repo)
  await handle.page.locator('.branch-row').first().click()
  await expect(projectTab(handle.page, 'Git')).toBeVisible({ timeout: 15000 })
}

export function projectTab(page: Page, label: string) {
  return page.locator('.tab-bar--primary .tab-bar__tab').filter({ hasText: label }).first()
}

/** The Git Integration frame showing `view`, once loaded, as a view to drive. */
export async function gitView(handle: AppHandle, view: string): Promise<ExtensionView> {
  return extensionPage(handle, `terminator.git-integration/dist/index.html?view=${view}`)
}

/** Opens the repository's Code Reviews tab from its sidebar header and returns its view.
 * A click on the header re-opens the tab when the click before left it open and did not
 * touch the tabs: the sidebar then reads it as chrome and dismisses the surfaces. */
export async function openCodeReviews(
  handle: AppHandle,
  workspace: string
): Promise<ExtensionView> {
  const header = workspaceRow(handle.page, workspace)
  const codeReviews = header.getByRole('button', { name: 'Code Reviews' })
  const panel = handle.page.locator('[data-extension-panel="terminator.git-integration"]')
  await header.hover()
  await codeReviews.click()
  // A click when the tab is already open and nothing else was touched reads as chrome and
  // closes it; clicking again re-opens it, so a closed panel is no reason to wait out a frame.
  if ((await panel.count()) === 0) {
    await header.hover()
    await codeReviews.click()
  }
  const view = await gitView(handle, 'code-reviews')
  // The queue or an open pull request: the tab reloads fresh on a re-open, so a
  // PR the test before left open shows again only from its queue row.
  await expect(view.locator('.rd-row, [aria-label="Close review"]').first()).toBeVisible({
    timeout: 30000,
  })
  return view
}

/** Clicks the project's Git tab and returns its view. */
export async function openGitTab(handle: AppHandle): Promise<ExtensionView> {
  await projectTab(handle.page, 'Git').click()
  return gitView(handle, 'project')
}
