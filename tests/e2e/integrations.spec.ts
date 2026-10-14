import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  launchApp,
  openSettingsSection,
  projectGroup,
  runQuickActionFromPanel,
} from './helpers'
import { connectJira, startJiraStub, type JiraStub } from './jira-stub'
import { allowCredentialsWithoutKeychain } from './main-stubs'
import { expectCentredInWindow } from './modal-centre'

// The issue-tracker integration against a local Jira (jira-stub.ts), from connect to
// disconnect, each step done as an operator does it and each assertion on what the app shows
// or what reached the tracker.

let handle: AppHandle
let stub: JiraStub

const jiraRow = () => handle.page.locator('.integrations__tracker', { hasText: 'Jira' })
const drawer = () => handle.page.getByRole('complementary', { name: 'Issue OPS-7' })

test.beforeAll(async () => {
  stub = await startJiraStub([
    {
      key: 'OPS-7',
      summary: 'Rotate the signing keys',
      description: 'Keys expire.',
      status: 'To Do',
    },
    { key: 'OPS-8', summary: 'Archive old builds', description: 'Disk is full.', status: 'Done' },
  ])
  handle = await launchApp(undefined, { NODE_EXTRA_CA_CERTS: stub.caPath })
  await allowCredentialsWithoutKeychain(handle.app)
  await createWorkspace(handle.page, 'Keys', mkdtempSync(join(tmpdir(), 'terminator-e2e-int-')))
  await addAndSelectProject(handle.page, 'Keys', 'rotate')
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub.shutDown()
})

async function connectingProvesCredential(): Promise<void> {
  await connectJira(handle.page, stub)
  expect(stub.requests).toContain('GET /rest/api/3/myself')
}

async function myIssuesQueryReachesTracker(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Integrations')
  const mine = page.locator('#jira-mine')
  await mine.fill('project = OPS ORDER BY updated DESC')
  await mine.blur()
  await closeSettingsPanel(page)
  await runQuickActionFromPanel(page, 'Link issue to branch')
  const dialog = page.getByRole('dialog', { name: 'Link an issue' })
  await expectCentredInWindow(dialog, 'Link an issue')
  await expect(dialog.locator('.link-issue__group')).toHaveText('Assigned to you')
  await expect(dialog.locator('.link-issue__row', { hasText: 'OPS-8' })).toBeVisible()
  const mineQuery = new URLSearchParams({ jql: 'project = OPS ORDER BY updated DESC' }).toString()
  expect(stub.requests.some((r) => r.includes(mineQuery))).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
}

async function searchAndLinkAttachIssue(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'Link issue to branch')
  const dialog = page.getByRole('dialog', { name: 'Link an issue' })
  await dialog.getByPlaceholder('Search, or type an issue key').fill('signing')
  await expect(dialog.locator('.link-issue__group')).toHaveText('Results')
  await expect(dialog.locator('.link-issue__row')).toHaveCount(1)
  await dialog.locator('.link-issue__row', { hasText: 'OPS-7' }).click()
  await dialog.getByRole('button', { name: 'Link OPS-7' }).click()
  await expect(dialog).toBeHidden()
  await expect(projectGroup(page, 'rotate')).toContainText('OPS-7')
}

async function drawerShowsIssueAndContext(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'View OPS-7')
  await expect(drawer().getByRole('heading', { name: 'Rotate the signing keys' })).toBeVisible()
  await expect(drawer().locator('.issue-drawer__context')).toContainText('OPS-7')
  await expect(drawer().locator('.issue-drawer__context')).toContainText('Keys expire.')
}

async function drawerCommentReachesTracker(): Promise<void> {
  await drawer().getByPlaceholder('Add a comment to OPS-7…').fill('Rotated on staging.')
  await drawer().getByRole('button', { name: 'Post comment' }).click()
  await expect(drawer().getByPlaceholder('Add a comment to OPS-7…')).toHaveValue('')
  expect(stub.comments.get('OPS-7')).toEqual(['Rotated on staging.'])
}

async function newTerminalGetsIssueContext(): Promise<void> {
  const { page } = handle
  const feed = drawer().getByRole('checkbox', { name: /Feed this issue to agent sessions/ })
  // Controlled by what main stores, so it changes once the write lands.
  if (!(await feed.isChecked())) await feed.click()
  await expect(feed).toBeChecked()
  await drawer().getByTitle('Close').click()
  await runQuickActionFromPanel(page, 'New tab')
  await expect(
    page.locator('.tmui-toast__message', { hasText: 'Session started with OPS-7' })
  ).toBeVisible({ timeout: 15000 })
}

async function feedOffStopsContext(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'View OPS-7')
  const feed = drawer().getByRole('checkbox', { name: /Feed this issue to agent sessions/ })
  await feed.click()
  await expect(feed).not.toBeChecked()
  await drawer().getByTitle('Close').click()
  await runQuickActionFromPanel(page, 'View OPS-7')
  await expect(
    drawer().getByRole('checkbox', { name: /Feed this issue to agent sessions/ })
  ).not.toBeChecked()
}

async function unlinkTakesIssueOff(): Promise<void> {
  const { page } = handle
  await drawer().getByRole('button', { name: 'Unlink OPS-7' }).click()
  await expect(drawer()).toBeHidden()
  await expect(projectGroup(page, 'rotate')).not.toContainText('OPS-7')
}

async function disconnectShowsConnectForm(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Integrations')
  await jiraRow().getByRole('button', { name: 'Disconnect' }).click()
  await expect(jiraRow().locator('.integrations__status')).toHaveText('Not connected')
  await expect(page.locator('#jira-site')).toBeVisible()
  await closeSettingsPanel(page)
}

test.describe.serial('a Jira connection, from connect to disconnect', () => {
  test(
    'connecting proves the credential against the tracker before storing it',
    connectingProvesCredential
  )

  test('changing "My issues" sends the new query to the tracker', myIssuesQueryReachesTracker)

  test('a search finds the issue, and linking attaches it to the branch', searchAndLinkAttachIssue)

  test(
    'the drawer reads the issue and shows the context sessions will get',
    drawerShowsIssueAndContext
  )

  test('a comment posted from the drawer reaches the tracker', drawerCommentReachesTracker)

  test(
    'a new terminal on the linked branch starts with the issue as context',
    newTerminalGetsIssueContext
  )

  test('turning the feed off stops it for the next terminal', feedOffStopsContext)

  test('unlinking from the drawer takes the issue off the branch', unlinkTakesIssueOff)

  test('disconnecting returns Jira to its connect form', disconnectShowsConnectForm)
})
