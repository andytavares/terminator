import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, expandWorkspace, type AppHandle } from './helpers'

// The claim this whole runtime rests on: starting a session produces a project
// in the operator's workspace, with a terminal in it, with `claude` running.
//
// Unit tests assert every part of that through a fake terminal. Only the real
// application can show that the parts are actually joined up — that the main
// process spawns the PTY, that the renderer adopts it into a tab, and that the
// command reaches it. Every previous round of this feature passed its unit
// tests while the wiring was dead, so this is the test that matters.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'terminator-agent-repo-'))
  const git = (...args: string[]): void => {
    // Deleted rather than blanked. Inherited from the outer git when this runs
    // inside a hook, they would point every command at the wrong repository —
    // and an empty GIT_DIR is not "unset", it is an invalid path.
    const env = { ...process.env }
    delete env.GIT_DIR
    delete env.GIT_INDEX_FILE
    delete env.GIT_WORK_TREE
    execFileSync('git', args, { cwd: repo, env })
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  git('add', '.')
  git('commit', '-m', 'initial')

  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

test('starting a session opens a project and a terminal running claude', async () => {
  const { page } = handle

  await createWorkspace(page, 'Agents', repo)
  await page.locator('.sv-statusbar').click()
  await expect(page.locator('.sv-screen')).toBeVisible()

  // The start panel lives on the attention queue.
  const repoPicker = page.locator('.sv-screen select').first()
  await expect(repoPicker).toBeVisible({ timeout: 15_000 })

  const started = await page.evaluate(async (repoPath: string) => {
    const api = (
      window as unknown as {
        electronAPI?: {
          supervision?: {
            assign?(request: unknown): Promise<{ ok: boolean; reason?: string }>
          }
        }
      }
    ).electronAPI?.supervision
    const workspaces = await (
      window as unknown as {
        electronAPI: { workspace: { list(): Promise<{ workspaces: Array<{ id: string }> }> } }
      }
    ).electronAPI.workspace.list()
    return api?.assign?.({
      repoPath,
      branch: 'feat/e2e-agent',
      autonomyLevel: 'read',
      instruction: 'Say the word banana and nothing else.',
      workspaceId: workspaces.workspaces[0]?.id ?? null,
    })
  }, repo)

  // Reported rather than assumed: a refusal here is the failure, and its
  // reason is the whole diagnosis.
  expect(started, `assign returned nothing`).toBeTruthy()
  expect(started?.reason ?? 'ok').toBe('ok')
  expect(started?.ok).toBe(true)

  // The working copy became a project in the workspace, named for the branch.
  await page.locator('.sv-statusbar').click()
  await expandWorkspace(page, 'Agents')
  const project = page.locator('.project-row__name', { hasText: 'feat/e2e-agent' })
  await expect(project).toBeVisible({ timeout: 30_000 })

  // And a terminal tab for it exists — this is the agent, not a view of it.
  await project.click()
  await expect(page.locator('.tab-bar__tab', { hasText: 'feat/e2e-agent' })).toBeVisible({
    timeout: 30_000,
  })

  // The tab is showing a live terminal, not an empty project.
  await expect(page.locator('.xterm-screen')).toHaveCount(1, { timeout: 30_000 })

  // The launch command was actually typed into it, and — since it was typed
  // before this tab existed — that it was held and replayed rather than
  // printed to nobody. Asserted on the rendered terminal, because "the PTY was
  // written to" is what the unit tests already cover; what they cannot show is
  // that it reached the screen.
  await expect(page.locator('.xterm-screen')).toContainText('claude --session-id', {
    timeout: 30_000,
  })
})
