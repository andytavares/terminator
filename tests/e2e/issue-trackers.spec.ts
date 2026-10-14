import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, createWorkspace, launchApp, projectGroup, type AppHandle } from './helpers'
import { git } from './git-harness'
import { allowCredentialsWithoutKeychain } from './main-stubs'
import { JIRA_SITE, startTrackerStub, type TrackerStub } from './tracker-stub'
import type { JiraState } from './tracker-stub-jira'
import type { LinearState } from './tracker-stub-linear'

/** Linear and Jira against stub servers at their real addresses (tracker-stub.ts): connect,
 * link a branch to an issue, the issue drawer, a session started with the issue, unlink,
 * whose issues are "mine", and disconnect. */

let handle: AppHandle
let stub: TrackerStub
let repo: string
let credentialStore = false
const BRANCH = 'main'

test.describe.configure({ mode: 'serial' })

/** Linear's state: Ada's API key, and one issue of hers beside one of Grace's. */
function linearState(): LinearState {
  return {
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
  }
}

/** Jira's state: Ada's credential and one issue. */
function jiraState(): JiraState {
  return {
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
}

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'terminator-e2e-trackers-repo-'))
  git(repo, 'init', '--quiet', '-b', BRANCH)
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'root')
  stub = await startTrackerStub(linearState(), jiraState())
  handle = await launchApp(undefined, stub.env)
  await allowCredentialsWithoutKeychain(handle.app)
  credentialStore = await handle.app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable()
  )
  await createWorkspace(handle.page, 'Trackers', repo)
  await projectGroup(handle.page, BRANCH).click()
})

// The core stores a tracker credential only with OS encryption: macOS gets it from
// --use-mock-keychain, Linux from allowCredentialsWithoutKeychain (Playwright's loader appends
// --password-store=basic there). The skip is for a platform that has neither.
test.beforeEach(() => {
  test.skip(!credentialStore, 'safeStorage has no OS encryption under Playwright here')
})

// Each step is bounded (closeApp kills the app after a deadline; the stub drops
// its tunnels), and each runs even when the one before it threw.
test.afterAll(async () => {
  try {
    await closeApp(handle)
  } finally {
    await stub?.shutDown()
    if (repo) rmSync(repo, { recursive: true, force: true })
  }
})

async function openIntegrations(): Promise<Page> {
  const { page } = handle
  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.settings-panel')
  await page.locator('.settings-panel__nav-item').filter({ hasText: 'Integrations' }).click()
  return page
}

async function escapeSettings(): Promise<void> {
  await handle.page.keyboard.press('Escape')
  await expect(handle.page.locator('.settings-panel')).toBeHidden()
}

const trackerRow = (page: Page, name: string) =>
  page.locator('.integrations__tracker').filter({ hasText: name })

/** The tracker reads as connected; if not, the failure says what reached the stub. */
async function connected(page: Page, name: string): Promise<void> {
  try {
    await expect(trackerRow(page, name)).toContainText('Connected as ada@acme.dev')
  } catch (error) {
    const seen = stub.diagnostics.join('\n  ') || 'nothing reached the proxy'
    throw new Error(`${(error as Error).message}\nstub saw:\n  ${seen}`, { cause: error })
  }
}

test('Linear and Jira connect with credentials their servers accept', async () => {
  const page = await openIntegrations()
  await page.locator('#linear-api-key').fill('lin_api_e2e')
  await page.getByRole('button', { name: 'Connect Linear' }).click()
  await connected(page, 'Linear')

  await page.locator('#jira-site').fill(JIRA_SITE)
  await page.locator('#jira-email').fill('ada@acme.dev')
  await page.locator('#jira-token').fill('jira-token')
  await page.getByRole('button', { name: 'Connect Jira' }).click()
  await connected(page, 'Jira')
  await escapeSettings()
})

async function openIssueLinkDialog(): Promise<Page> {
  const { page } = handle
  await projectGroup(page, BRANCH).click({ button: 'right' })
  await page.getByRole('button', { name: 'Link issue…' }).click()
  await expect(page.getByRole('dialog', { name: 'Link an issue' })).toBeVisible()
  return page
}

const issueRows = (page: Page) => page.locator('.link-issue__row .link-issue__key')

test('linking lists my issues from both trackers, and search finds by title', async () => {
  const page = await openIssueLinkDialog()
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
  const mine = trackerRow(page, 'Linear').getByLabel('Assigned-issue lookup')
  await mine.fill('grace@acme.dev')
  await mine.blur()
  await trackerRow(page, 'Jira').getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect Jira' })).toBeVisible()
  await escapeSettings()

  page = await openIssueLinkDialog()
  await expect(issueRows(page)).toHaveText(['ENG-40'])
  await page.getByRole('button', { name: 'Cancel' }).click()
})
