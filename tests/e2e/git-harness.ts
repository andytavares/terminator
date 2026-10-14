import { expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git } from './foundry-harness'
import { createWorkspace, workspaceRow, type AppHandle } from './helpers'

// Git Integration specs' setup: a repository whose remote is a local bare one (which the stub
// GitHub serves pull requests from), and each view, its own WebContentsView, as a Playwright page.

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

/** The Git Integration view showing `view`, once loaded, as a page to drive. */
export async function gitView(handle: AppHandle, view: string): Promise<Page> {
  const findGitView = () =>
    handle.app
      .windows()
      .find(
        (page) =>
          page.url().startsWith('ext://terminator.git-integration/') &&
          new URL(page.url()).searchParams.get('view') === view
      )
  await expect
    .poll(() => Boolean(findGitView()), { message: `no ${view} view`, timeout: 20000 })
    .toBe(true)
  const page = findGitView() as Page
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Opens the repository's Code Reviews tab from its sidebar header and returns its view. */
export async function openCodeReviews(handle: AppHandle, workspace: string): Promise<Page> {
  const header = workspaceRow(handle.page, workspace)
  await header.hover()
  await header.getByRole('button', { name: 'Code Reviews' }).click()
  return gitView(handle, 'code-reviews')
}

/** Clicks the project's Git tab and returns its view. */
export async function openGitTab(handle: AppHandle): Promise<Page> {
  await projectTab(handle.page, 'Git').click()
  return gitView(handle, 'project')
}
