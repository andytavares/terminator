import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, createWorkspace, launchApp, projectGroup, type AppHandle } from './helpers'
import { git } from './git-harness'
import { allowCredentialsWithoutKeychain } from './main-stubs'
import { expectCentredInWindow } from './modal-centre'
import { startTrackerStub, type TrackerStub } from './tracker-stub'
import type { LinearState } from './tracker-stub-linear'

// Linear against a stub server at its real address (tracker-stub.ts), each step done
// as an operator does it, each assertion on what the app shows or what reached the tracker.

let handle: AppHandle
let stub: TrackerStub
let repo: string
let credentialStore = false
const BRANCH = 'main'

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

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'terminator-e2e-trackers-repo-'))
  git(repo, 'init', '--quiet', '-b', BRANCH)
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'root')
  stub = await startTrackerStub(linearState())
  handle = await launchApp(undefined, stub.env)
  await allowCredentialsWithoutKeychain(handle.app)
  credentialStore = await handle.app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable()
  )
  await createWorkspace(handle.page, 'Trackers', repo)
  await projectGroup(handle.page, BRANCH).click()
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
  await expect(page.locator('.settings-panel')).toBeVisible()
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

/** "Connected as" is the account the tracker answered for the credential: the stub refuses
 * any other, so a connection proves the credential before the app stores it. */
async function linearConnects(): Promise<void> {
  const page = await openIntegrations()
  await page.locator('#linear-api-key').fill('lin_api_e2e')
  await page.getByRole('button', { name: 'Connect Linear' }).click()
  await connected(page, 'Linear')
  await escapeSettings()
}

const linkDialog = (page: Page) => page.getByRole('dialog', { name: 'Link an issue' })
const issueRows = (page: Page) => page.locator('.link-issue__row .link-issue__key')

async function openIssueLinkDialog(): Promise<Page> {
  const { page } = handle
  await projectGroup(page, BRANCH).click({ button: 'right' })
  await page.getByRole('button', { name: 'Link issue…' }).click()
  await expect(linkDialog(page)).toBeVisible()
  return page
}

async function linkListsMineAndSearchLinks(): Promise<void> {
  const page = await openIssueLinkDialog()
  await expectCentredInWindow(linkDialog(page), 'Link an issue')
  await expect(issueRows(page)).toHaveText(['ENG-12'], { useInnerText: true })
  await page.getByPlaceholder('Search, or type an issue key').fill('crash')
  await expect(issueRows(page)).toHaveText(['ENG-12'])
  await expect(page.locator('.link-issue__failures')).toHaveCount(0)
  await page.locator('.link-issue__row').filter({ hasText: 'ENG-12' }).click()
  await page.getByRole('button', { name: 'Link ENG-12' }).click()
  await expect(
    projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' })
  ).toBeVisible()
}

const drawerOf = (page: Page, key: string) =>
  page.getByRole('complementary', { name: `Issue ${key}` })

async function drawerFeedsAndComments(): Promise<void> {
  const { page } = handle
  await projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' }).click()
  const drawer = drawerOf(page, 'ENG-12')
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
}

async function sessionStartsWith(key: string): Promise<void> {
  await expect(
    handle.page.locator('.tmui-toast__message', { hasText: `Session started with ${key}` })
  ).toBeVisible()
}

async function newSessionStartsWithLinearIssue(): Promise<void> {
  const { page } = handle
  await projectGroup(page, BRANCH).hover()
  await projectGroup(page, BRANCH)
    .getByRole('button', { name: `New terminal in ${BRANCH}` })
    .click()
  await sessionStartsWith('ENG-12')
}

async function unlinkFromSidebarDrawer(): Promise<void> {
  const { page } = handle
  await projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' }).click()
  await page.getByRole('button', { name: 'Unlink ENG-12' }).click()
  await expect(projectGroup(page, BRANCH).getByRole('button', { name: 'Open ENG-12' })).toHaveCount(
    0
  )
}

async function mineChangesAndDisconnectedGo(): Promise<void> {
  let page = await openIntegrations()
  const mine = trackerRow(page, 'Linear').getByLabel('Assigned-issue lookup')
  await mine.fill('grace@acme.dev')
  await mine.blur()
  await escapeSettings()
  page = await openIssueLinkDialog()
  await expect(issueRows(page)).toHaveText(['ENG-40'])
  await page.getByRole('button', { name: 'Cancel' }).click()
  page = await openIntegrations()
  await trackerRow(page, 'Linear').getByRole('button', { name: 'Disconnect' }).click()
  await expect(trackerRow(page, 'Linear').locator('.integrations__status')).toHaveText(
    'Not connected'
  )
  await expect(page.getByRole('button', { name: 'Connect Linear' })).toBeVisible()
  await escapeSettings()
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const TRACKER_STEPS: Steps = [
  ['Linear connects with a credential its server accepts', linearConnects],
  ['linking lists my issues by assignee, and search finds by title', linkListsMineAndSearchLinks],
  [
    'the drawer previews the agent context, feeds it to sessions, and posts a comment to Linear',
    drawerFeedsAndComments,
  ],
  [
    'a new session on the branch starts with the issue, and says so',
    newSessionStartsWithLinearIssue,
  ],
  ['unlinking from the drawer takes the issue off the branch', unlinkFromSidebarDrawer],
  [
    "changing whose issues are mine changes what Link lists, and a disconnected tracker's go",
    mineChangesAndDisconnectedGo,
  ],
]

test('Linear issues are linked to a branch, read, commented on and fed to sessions', async () => {
  // The core stores a tracker credential only with OS encryption: macOS gets it from
  // --use-mock-keychain, Linux from allowCredentialsWithoutKeychain. The skip is for neither.
  test.skip(!credentialStore, 'safeStorage has no OS encryption under Playwright here')
  for (const [title, body] of TRACKER_STEPS) await test.step(title, body)
})
