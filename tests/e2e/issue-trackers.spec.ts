import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, createWorkspace, launchApp, projectGroup, type AppHandle } from './helpers'
import { git } from './git-harness'
import { JIRA_SITE, startTrackerStub, type TrackerStub } from './tracker-stub'

/**
 * Linear and Jira, end to end, against stub servers at their real addresses
 * (tracker-stub.ts): connecting both, linking a branch to an issue found by
 * listing and by search, the issue drawer's context preview, injection toggle
 * and comment, the notice when a session starts with the issue, unlinking,
 * changing whose issues are "mine", and disconnecting.
 */

let handle: AppHandle
let stub: TrackerStub
let repo: string
let credentialStore = false
const BRANCH = 'main'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'terminator-e2e-trackers-repo-'))
  git(repo, 'init', '--quiet', '-b', BRANCH)
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'root')
  stub = await startTrackerStub(
    {
      apiKey: 'lin_api_e2e',
      viewer: { name: 'Ada Lovelace', email: 'ada@acme.dev' },
      issues: [
        {
          identifier: 'ENG-12',
          title: 'Sidebar crashes on resize',
          description: 'Dragging the divider past 600px throws.',
          state: { name: 'In Progress', type: 'started' },
          assigneeEmail: 'ada@acme.dev',
          comments: [],
        },
        {
          identifier: 'ENG-40',
          title: 'Add dark mode to the drawer',
          description: '',
          state: { name: 'Todo', type: 'unstarted' },
          assigneeEmail: 'grace@acme.dev',
          comments: [],
        },
      ],
      operations: [],
    },
    {
      account: { displayName: 'Ada L', emailAddress: 'ada@acme.dev' },
      credential: 'ada@acme.dev:jira-token',
      issues: [
        {
          key: 'OPS-7',
          summary: 'Rotate the deploy keys',
          status: { name: 'To Do', category: 'new' },
          description: 'Quarterly.',
          comments: [],
        },
      ],
      searches: [],
    }
  )
  handle = await launchApp(undefined, stub.env)
  credentialStore = await handle.app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable()
  )
  await createWorkspace(handle.page, 'Trackers', repo)
  await projectGroup(handle.page, BRANCH).click()
})

// The core refuses to store a tracker credential without OS encryption. On
// macOS Playwright's --use-mock-keychain provides it; on Linux Playwright's
// Electron loader appends --password-store=basic
// (playwright-core/lib/server/electron/loader.js), under which safeStorage
// reports no encryption, so nothing here can connect.
test.beforeEach(() => {
  test.skip(!credentialStore, 'safeStorage has no OS encryption under Playwright here')
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.close()
  if (repo) rmSync(repo, { recursive: true, force: true })
})

async function openIntegrations(): Promise<Page> {
  const { page } = handle
  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.settings-panel')
  await page.locator('.settings-panel__nav-item').filter({ hasText: 'Integrations' }).click()
  return page
}

async function closeSettings(): Promise<void> {
  await handle.page.keyboard.press('Escape')
  await expect(handle.page.locator('.settings-panel')).toBeHidden()
}

const tracker = (page: Page, name: string) =>
  page.locator('.integrations__tracker').filter({ hasText: name })

test('Linear and Jira connect with credentials their servers accept', async () => {
  const page = await openIntegrations()
  await page.locator('#linear-api-key').fill('lin_api_e2e')
  await page.getByRole('button', { name: 'Connect Linear' }).click()
  await expect(tracker(page, 'Linear')).toContainText('Connected as ada@acme.dev')

  await page.locator('#jira-site').fill(JIRA_SITE)
  await page.locator('#jira-email').fill('ada@acme.dev')
  await page.locator('#jira-token').fill('jira-token')
  await page.getByRole('button', { name: 'Connect Jira' }).click()
  await expect(tracker(page, 'Jira')).toContainText('Connected as ada@acme.dev')
  await closeSettings()
})

async function openLinkDialog(): Promise<Page> {
  const { page } = handle
  await projectGroup(page, BRANCH).click({ button: 'right' })
  await page.getByRole('button', { name: 'Link issue…' }).click()
  await expect(page.getByRole('dialog', { name: 'Link an issue' })).toBeVisible()
  return page
}

const issueRows = (page: Page) => page.locator('.link-issue__row .link-issue__key')

test('linking lists my issues from both trackers, and search finds by title', async () => {
  const page = await openLinkDialog()
  await expect(issueRows(page)).toHaveText(['ENG-12', 'OPS-7'], { useInnerText: true })

  await page.getByPlaceholder('Search, or type an issue key').fill('crash')
  await expect(issueRows(page)).toHaveText(['ENG-12'])
  await expect(page.locator('.link-issue__failures')).toHaveCount(0)
  await page.locator('.link-issue__row').filter({ hasText: 'ENG-12' }).click()
  await page.getByRole('button', { name: 'Link ENG-12' }).click()

  await expect(
    projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' })
  ).toBeVisible()
})

test('the drawer previews the agent context, feeds it to sessions, and posts a comment', async () => {
  const { page } = handle
  await projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' }).click()
  const drawer = page.getByRole('complementary', { name: 'Issue ENG-12' })
  await expect(drawer.locator('.issue-drawer__title')).toHaveText('Sidebar crashes on resize')

  const feed = drawer.getByLabel(/Feed this issue to agent sessions/)
  // A link feeds its issue by default; turn it off, then on again.
  await expect(feed).toBeChecked()
  await feed.click()
  await expect(feed).not.toBeChecked()
  await feed.click()
  await expect(feed).toBeChecked()
  await expect(drawer.locator('.issue-drawer__context')).toContainText('Sidebar crashes on resize')

  await drawer.getByPlaceholder('Add a comment to ENG-12…').fill('Reproduced at 640px.')
  await drawer.getByRole('button', { name: 'Post comment' }).click()
  await expect(drawer.locator('.issue-drawer__comment')).toContainText('Reproduced at 640px.')
  expect(stub.linear.issues[0].comments.map((c) => c.body)).toEqual(['Reproduced at 640px.'])
})

test('a new session on the branch starts with the issue, and says so', async () => {
  const { page } = handle
  await projectGroup(page, BRANCH).hover()
  await projectGroup(page, BRANCH)
    .getByRole('button', { name: `New terminal in ${BRANCH}` })
    .click()
  await expect(
    page.locator('.tmui-toast__message', { hasText: 'Session started with ENG-12' })
  ).toBeVisible({
    timeout: 15000,
  })
})

test('unlinking from the drawer takes the issue off the branch', async () => {
  const { page } = handle
  await projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' }).click()
  await page.getByRole('button', { name: 'Unlink ENG-12' }).click()
  await expect(projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' })).toHaveCount(
    0
  )
})

test("changing whose issues are mine changes what Link lists, and a disconnected tracker's go", async () => {
  let page = await openIntegrations()
  const mine = tracker(page, 'Linear').getByLabel('Assigned-issue lookup')
  await mine.fill('grace@acme.dev')
  await mine.blur()
  await tracker(page, 'Jira').getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect Jira' })).toBeVisible()
  await closeSettings()

  page = await openLinkDialog()
  await expect(issueRows(page)).toHaveText(['ENG-40'])
  await page.getByRole('button', { name: 'Cancel' }).click()
})
