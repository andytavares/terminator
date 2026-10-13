import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, closeSettings, launchApp, type AppHandle } from './helpers'
import { git, makeRepoWithRemote, openGitTab, openRepo, writeFile } from './git-harness'
import { openExtensionSettings, settingRow } from './extension-settings-page'

/**
 * Git Integration's commit and changed-files settings, changed on its settings
 * page and seen in the Git tab: the file list stops at the configured limit
 * and says so, and a commit made with sign-off on ends with a Signed-off-by
 * trailer (https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff).
 */

let handle: AppHandle
let repo: string
let bare: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-git-settings'))
  for (let i = 0; i < 12; i++) writeFile(repo, `note-${String(i).padStart(2, '0')}.md`, `${i}\n`)
  handle = await launchApp()
  await openRepo(handle, 'Git Settings', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

test('the changed-files list stops at "Max displayed changed files" and says so', async () => {
  const view = await openGitTab(handle)
  await expect(view.locator('.staging-area__file-row')).toHaveCount(12)
  await expect(view.locator('.staging-area__truncation-banner')).toBeHidden()

  const page = await openExtensionSettings(handle.page, 'Git Integration')
  await settingRow(page, 'Max displayed changed files').locator('input').fill('10')
  await closeSettings(handle.page)

  await expect(view.locator('.staging-area__file-row')).toHaveCount(10, { timeout: 15000 })
  await expect(view.locator('.staging-area__truncation-banner')).toHaveText(
    'Showing first 10 files.'
  )
})

test('a commit made with "Add sign-off to commits" on ends with Signed-off-by', async () => {
  const page = await openExtensionSettings(handle.page, 'Git Integration')
  await settingRow(page, 'Add sign-off to commits').getByRole('switch').click()
  await closeSettings(handle.page)

  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Stage All' }).click()
  await view.getByPlaceholder('Commit message…').fill('Add notes')
  await view.getByRole('button', { name: 'Commit', exact: true }).click()

  await expect
    .poll(() => git(repo, 'log', '-1', '--format=%B'))
    .toBe('Add notes\n\nSigned-off-by: E2E <e2e@example.com>')
})
