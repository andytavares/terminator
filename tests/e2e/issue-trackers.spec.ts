import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeApp,
  createWorkspace,
  launchApp,
  projectGroup,
  runQuickActionFromPanel,
  type AppHandle,
} from './helpers'
import { git } from './git-harness'
import { allowCredentialsWithoutKeychain } from './main-stubs'
import { expectCentredInWindow } from './modal-centre'
import { JIRA_SITE, startTrackerStub, type TrackerStub } from './tracker-stub'
import type { JiraState } from './tracker-stub-jira'
import type { LinearState } from './tracker-stub-linear'

// Linear and Jira against stub servers at their real addresses (tracker-stub.ts), each step done
// as an operator does it, each assertion on what the app shows or what reached the tracker.

let handle: AppHandle
let stub: TrackerStub
let repo: string
let credentialStore = false
const BRANCH = 'main'
const MY_JIRA_ISSUES = 'project = OPS ORDER BY updated DESC'

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

/** "Connected as" is the account the tracker answered for the credential: each stub refuses
 * any other, so a connection proves the credential before the app stores it. */
async function bothConnect(): Promise<void> {
  const page = await openIntegrations()
  await page.locator('#linear-api-key').fill('lin_api_e2e')
  await page.getByRole('button', { name: 'Connect Linear' }).click()
  await connected(page, 'Linear')
  await page.locator('#jira-site').fill(JIRA_SITE)
  await page.locator('#jira-email').fill('ada@acme.dev')
  await page.locator('#jira-token').fill('jira-token')
  await page.getByRole('button', { name: 'Connect Jira' }).click()
  await connected(page, 'Jira')
  const mine = page.locator('#jira-mine')
  await mine.fill(MY_JIRA_ISSUES)
  await mine.blur()
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
  await expect(issueRows(page)).toHaveText(['ENG-12', 'OPS-7'], { useInnerText: true })
  expect(stub.jira.searches, 'Jira was not asked with the "My issues" query').toContain(
    MY_JIRA_ISSUES
  )
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

async function jiraIssueLinkedFromQuickActions(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'Link issue to branch')
  const dialog = linkDialog(page)
  await dialog.getByPlaceholder('Search, or type an issue key').fill('deploy')
  await expect(issueRows(page)).toHaveText(['OPS-7'])
  await dialog.locator('.link-issue__row', { hasText: 'OPS-7' }).click()
  await dialog.getByRole('button', { name: 'Link OPS-7' }).click()
  await expect(dialog).toBeHidden()
  await expect(projectGroup(page, BRANCH)).toContainText('OPS-7')
}

async function jiraDrawerCommentReachesTracker(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'View OPS-7')
  const drawer = drawerOf(page, 'OPS-7')
  await expect(drawer.getByRole('heading', { name: 'Rotate the deploy keys' })).toBeVisible()
  await expect(drawer.locator('.issue-drawer__context')).toContainText('Quarterly.')
  await drawer.getByPlaceholder('Add a comment to OPS-7…').fill('Rotated on staging.')
  await drawer.getByRole('button', { name: 'Post comment' }).click()
  await expect(drawer.getByPlaceholder('Add a comment to OPS-7…')).toHaveValue('')
  expect(stub.jira.issues[0].comments.map((c) => c.body)).toEqual(['Rotated on staging.'])
  await drawer.getByTitle('Close').click()
}

async function newTabStartsWithJiraIssue(): Promise<void> {
  await runQuickActionFromPanel(handle.page, 'New tab')
  await sessionStartsWith('OPS-7')
}

const feedBox = (page: Page) =>
  drawerOf(page, 'OPS-7').getByRole('checkbox', { name: /Feed this issue to agent sessions/ })

async function feedOffStaysOffThenUnlink(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'View OPS-7')
  await feedBox(page).click()
  await expect(feedBox(page)).not.toBeChecked()
  await drawerOf(page, 'OPS-7').getByTitle('Close').click()
  await runQuickActionFromPanel(page, 'View OPS-7')
  await expect(feedBox(page)).not.toBeChecked()
  await drawerOf(page, 'OPS-7').getByRole('button', { name: 'Unlink OPS-7' }).click()
  await expect(drawerOf(page, 'OPS-7')).toBeHidden()
  await expect(projectGroup(page, BRANCH)).not.toContainText('OPS-7')
}

async function mineChangesAndDisconnectedGo(): Promise<void> {
  let page = await openIntegrations()
  const mine = trackerRow(page, 'Linear').getByLabel('Assigned-issue lookup')
  await mine.fill('grace@acme.dev')
  await mine.blur()
  await trackerRow(page, 'Jira').getByRole('button', { name: 'Disconnect' }).click()
  await expect(trackerRow(page, 'Jira').locator('.integrations__status')).toHaveText(
    'Not connected'
  )
  await expect(page.getByRole('button', { name: 'Connect Jira' })).toBeVisible()
  await escapeSettings()
  page = await openIssueLinkDialog()
  await expect(issueRows(page)).toHaveText(['ENG-40'])
  await page.getByRole('button', { name: 'Cancel' }).click()
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const TRACKER_STEPS: Steps = [
  [
    'Linear and Jira connect with credentials their servers accept, and Jira takes a "My issues" query',
    bothConnect,
  ],
  [
    'linking lists my issues from both trackers by that query, and search finds by title',
    linkListsMineAndSearchLinks,
  ],
  [
    'the drawer previews the agent context, feeds it to sessions, and posts a comment to Linear',
    drawerFeedsAndComments,
  ],
  [
    'a new session on the branch starts with the issue, and says so',
    newSessionStartsWithLinearIssue,
  ],
  ['unlinking from the drawer takes the issue off the branch', unlinkFromSidebarDrawer],
  ['a Jira issue is found and linked from Quick Actions', jiraIssueLinkedFromQuickActions],
  [
    'the Jira drawer reads the issue, and a comment posted from it reaches Jira',
    jiraDrawerCommentReachesTracker,
  ],
  [
    'a new tab on the linked branch starts with the Jira issue as context',
    newTabStartsWithJiraIssue,
  ],
  [
    'turning the feed off stays off, and unlinking takes the Jira issue off the branch',
    feedOffStaysOffThenUnlink,
  ],
  [
    "changing whose issues are mine changes what Link lists, and a disconnected tracker's go",
    mineChangesAndDisconnectedGo,
  ],
]

test('Linear and Jira issues are linked to a branch, read, commented on and fed to sessions', async () => {
  // The core stores a tracker credential only with OS encryption: macOS gets it from
  // --use-mock-keychain, Linux from allowCredentialsWithoutKeychain. The skip is for neither.
  test.skip(!credentialStore, 'safeStorage has no OS encryption under Playwright here')
  for (const [title, body] of TRACKER_STEPS) await test.step(title, body)
})
