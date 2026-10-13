import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { AppHandle, launchApp, closeApp, createWorkspace, e2eTempDir } from './helpers'

/**
 * Settings → Git → Branch Exclude Patterns, end to end: real git, the real
 * settings store and the real handler. The setting existed with nothing
 * reading it after the sidebar's branch switcher was removed, and a unit test
 * with mocked stores could not have noticed.
 */
let handle: AppHandle
let repo: string

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

async function setPatterns(patterns: string[]): Promise<void> {
  await handle.page.evaluate(
    (p) =>
      window.electronAPI.settings.updateGlobal({
        git: { branchExcludePatterns: p },
      }),
    patterns
  )
}

async function branchNames(): Promise<string[]> {
  const r = await handle.page.evaluate((path) => window.electronAPI.git.listBranches(path), repo)
  return r.branches.map((b) => b.name).sort()
}

test.beforeAll(async () => {
  repo = e2eTempDir('terminator-e2e-exclude-')
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  git('commit', '--allow-empty', '-m', 'root')
  for (const b of ['feat/x', 'gh-readonly-queue/main/pr-248-3f1a2b9c', 'trunk-merge/pr-9']) {
    git('branch', b)
  }
  handle = await launchApp()
  await createWorkspace(handle.page, 'Exclude Patterns', repo)
})

test.afterAll(async () => {
  if (handle !== undefined) await setPatterns([]).catch(() => {})
  await closeApp(handle)
})

test('branches matching an exclusion pattern are left out of the branch list', async () => {
  await setPatterns([])
  expect(await branchNames()).toEqual([
    'feat/x',
    'gh-readonly-queue/main/pr-248-3f1a2b9c',
    'main',
    'trunk-merge/pr-9',
  ])

  await setPatterns(['gh-readonly-queue/*', 'trunk-merge/*'])
  expect(await branchNames()).toEqual(['feat/x', 'main'])
})
