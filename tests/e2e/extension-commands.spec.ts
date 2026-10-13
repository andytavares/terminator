import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  closeApp,
  createWorkspace,
  inExtensionView,
  launchApp,
  projectGroup,
  runQuickAction,
} from './helpers'
import { git, makeFixtureRepo } from './foundry-harness'

// The bundled extensions' commands no other spec runs, run from Quick
// Actions like any operator would, each asserted by what it brings up.

let handle: AppHandle
let repo: string
let remote: string

const gitTab = () => handle.page.locator('.tab-bar--primary .tab-bar__tab', { hasText: 'Git' })
const activeElementIn = (part: string) =>
  inExtensionView<string>(
    handle,
    part,
    `(document.activeElement && (document.activeElement.getAttribute('placeholder') || document.activeElement.tagName)) || ''`
  ).catch(() => '')

test.beforeAll(async () => {
  remote = mkdtempSync(join(tmpdir(), 'terminator-e2e-cmd-remote-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', remote])
  repo = makeFixtureRepo('terminator-e2e-commands-')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-u', 'origin', 'main')
  handle = await launchApp()
  await createWorkspace(handle.page, 'Cmds', repo)
  await projectGroup(handle.page, 'main').click()
  await expect(handle.page.getByRole('textbox', { name: 'Terminal input' }).first()).toBeVisible({
    timeout: 15000,
  })
})

test.afterAll(async () => closeApp(handle))

test('Git → Commit… opens the Git tab with the cursor in the commit message', async () => {
  await runQuickAction(handle.page, 'Commit…')
  await expect(gitTab()).toHaveClass(/tab-bar__tab--active/, { timeout: 15000 })
  await expect.poll(() => activeElementIn('terminator.git-integration')).toBe('Commit message…')
})

test('Git → Create PR… opens the pull request dialog', async () => {
  // A fresh app, so the Git view does not exist yet here either.
  const { userDataDir } = handle
  await closeApp(handle)
  handle = await launchApp(userDataDir)
  await projectGroup(handle.page, 'main').click()
  await runQuickAction(handle.page, 'Create PR…')
  await expect(gitTab()).toHaveClass(/tab-bar__tab--active/)
  await expect
    .poll(() =>
      inExtensionView<string>(
        handle,
        'terminator.git-integration',
        'document.documentElement.innerText'
      ).catch(() => '')
    )
    .toContain('Open Pull Request')
})

test('Git → Pull fast-forwards to a commit pushed elsewhere', async () => {
  const other = mkdtempSync(join(tmpdir(), 'terminator-e2e-cmd-clone-'))
  execFileSync('git', ['clone', remote, other])
  git(other, 'config', 'user.email', 'e2e@example.com')
  git(other, 'config', 'user.name', 'E2E')
  writeFileSync(join(other, 'pulled.txt'), 'from elsewhere\n')
  git(other, 'add', '.')
  git(other, 'commit', '-m', 'pushed elsewhere')
  git(other, 'push', 'origin', 'main')
  await runQuickAction(handle.page, 'Pull')
  await expect(handle.page.locator('.tmui-toast__message', { hasText: 'Pulled main' })).toBeVisible(
    {
      timeout: 15000,
    }
  )
  const head = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo }).toString().trim()
  expect(head).toBe('pushed elsewhere')
})

test('Foundry → New work order… opens the Forge with the cursor in the idea box', async () => {
  await runQuickAction(handle.page, 'New work order…')
  await expect(handle.page.locator('[data-extension-panel="terminator.foundry"]')).toHaveCount(1, {
    timeout: 30000,
  })
  await expect
    .poll(() => activeElementIn('terminator.foundry'), { timeout: 15000 })
    .toBe('Describe what you want built or fixed…')
})

test('Foundry → Toggle factory view switches the stored view and back', async () => {
  const view = async () =>
    (await handle.page.evaluate(() => window.electronAPI.extension.getSettingsValues())).values[
      'terminator.foundry.view'
    ] ?? 'list'
  expect(await view()).toBe('list')
  await runQuickAction(handle.page, 'Toggle factory view')
  await expect.poll(view).toBe('factory')
  await expect
    .poll(() =>
      inExtensionView<string>(
        handle,
        'terminator.foundry',
        `document.querySelector('button[aria-label="Factory view"]')?.getAttribute('aria-pressed') ?? ''`
      ).catch(() => '')
    )
    .toBe('true')
  await runQuickAction(handle.page, 'Toggle factory view')
  await expect.poll(view).toBe('list')
})
