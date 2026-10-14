import { test, expect, type Locator } from '@playwright/test'
import { rmSync } from 'node:fs'
import {
  closeApp,
  closeSettingsPanel,
  launchApp,
  openSettingsSection,
  projectGroup,
  type AppHandle,
} from './helpers'
import { git, makeRepoWithRemote, openGitTab, openRepo, writeFile } from './git-harness'
import { settingRow } from './extension-settings-page'

/** A `workspaceScoped` setting applies only in its workspace until "Use global default": Git
 * Integration's sign-off, read for the repository committed in, adds a Signed-off-by trailer
 * (https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff). */

let handle: AppHandle
const repos: string[] = []
let signed: string
let plain: string

test.describe.configure({ mode: 'serial' })

/** A checkout whose branch is named `branch`, so its sidebar row is told apart from the other's. */
function repoOnBranch(branch: string): string {
  const { repo, bare } = makeRepoWithRemote(`terminator-e2e-ws-${branch}`)
  repos.push(repo, bare)
  git(repo, 'branch', '-m', branch)
  return repo
}

test.beforeAll(async () => {
  signed = repoOnBranch('signed-work')
  plain = repoOnBranch('plain-work')
  handle = await launchApp()
  await openRepo(handle, 'Signed Repo', signed)
  await openRepo(handle, 'Plain Repo', plain)
})

test.afterAll(async () => {
  await closeApp(handle)
  for (const dir of repos) rmSync(dir, { recursive: true, force: true })
})

/** Workspace Settings of the workspace whose branch row `branch` is, opened. */
async function openWorkspaceSettings(branch: string): Promise<Locator> {
  await projectGroup(handle.page, branch).click()
  await openSettingsSection(handle.page, 'Workspace Settings')
  return handle.page.locator('.settings-panel__content')
}

const signOffSwitchIn = (settings: Locator) =>
  settingRow(settings, 'Add sign-off to commits').getByRole('switch')

/** Git Integration's "Use global default", not a core setting's. */
const useGlobalDefault = (settings: Locator) =>
  settings
    .locator('.extension-settings-panel', { hasText: 'Git Integration' })
    .getByRole('button', { name: 'Use global default' })

/** Writes a file in `repo`, then stages and commits it from the Git tab of `branch`; returns the message. */
async function commitFrom(branch: string, repo: string, file: string): Promise<string> {
  writeFile(repo, file, `${file}\n`)
  await projectGroup(handle.page, branch).click()
  const view = await openGitTab(handle)
  await expect(view.locator('.staging-area__file-row', { hasText: file })).toBeVisible({
    timeout: 15000,
  })
  await view.getByRole('button', { name: 'Stage All' }).click()
  await view.getByPlaceholder('Commit message…').fill(`Add ${file}`)
  await view.getByRole('button', { name: 'Commit', exact: true }).click()
  await expect.poll(() => git(repo, 'log', '-1', '--format=%s')).toBe(`Add ${file}`)
  return git(repo, 'log', '-1', '--format=%B')
}

test("sign-off switched on in one workspace's settings signs its commits, not the other's", async () => {
  const settings = await openWorkspaceSettings('signed-work')
  await expect(signOffSwitchIn(settings)).toHaveAttribute('aria-checked', 'false')
  await signOffSwitchIn(settings).click()
  await expect(useGlobalDefault(settings)).toBeVisible()
  await closeSettingsPanel(handle.page)

  expect(await commitFrom('signed-work', signed, 'one.md')).toBe(
    'Add one.md\n\nSigned-off-by: E2E <e2e@example.com>'
  )
  expect(await commitFrom('plain-work', plain, 'one.md')).toBe('Add one.md')

  const plainSettings = await openWorkspaceSettings('plain-work')
  await expect(signOffSwitchIn(plainSettings)).toHaveAttribute('aria-checked', 'false')
  await expect(useGlobalDefault(plainSettings)).toBeHidden()
  await closeSettingsPanel(handle.page)
})

test('"Use global default" hands sign-off back to the global value', async () => {
  const settings = await openWorkspaceSettings('signed-work')
  await expect(signOffSwitchIn(settings)).toHaveAttribute('aria-checked', 'true')
  await useGlobalDefault(settings).click()
  await expect(signOffSwitchIn(settings)).toHaveAttribute('aria-checked', 'false')
  await expect(useGlobalDefault(settings)).toBeHidden()
  await closeSettingsPanel(handle.page)

  expect(await commitFrom('signed-work', signed, 'two.md')).toBe('Add two.md')
})
