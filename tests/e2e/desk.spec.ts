import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  readTerminalRows,
  runQuickActionFromPanel,
} from './helpers'
import { expectTerminalFocused, openHome, runInVisibleTerminal } from './session-views'

// Home is the Desk (ADR 117): an agent's numbered question lands in the "Needs you" band and is
// answered there, work is listed under "Tasks" and opens a drawer, Insights answers its
// questions, and Start work begins a terminal. Launched with the default setting, which hides
// the branch tree while Home shows.

// A numbered choice as Claude Code draws it, then a wait for one key. ❯ is sent as its UTF-8 bytes
// in octal: typed as itself it reaches a shell with no UTF-8 locale (as on CI) as unknown characters.
const ASK_COMMAND =
  "clear; printf ' Do you want to create BoardScreen.tsx?\\n \\342\\235\\257 1. Yes\\n   2. Yes, and allow edits this session\\n   3. No\\n'; " +
  'read -k 1 -s key; clear; echo answered-$key'
const BRANCH = 'ask-branch'
const INSIGHTS_QUESTIONS = [
  'How much shipped?',
  'How long from start to merge?',
  'How long do agents wait on me?',
  'How am I spending agent time?',
  'Where did the time go?',
]

let handle: AppHandle

test.beforeAll(async () => {
  // An empty gh config keeps the developer's own pull requests from joining Needs you.
  const env = { XDG_CONFIG_HOME: e2eTempDir('no-gh-'), GH_TOKEN: '', GITHUB_TOKEN: '' }
  handle = await launchApp(undefined, env, { hideSidebarOnHome: true })
})

test.afterAll(async () => {
  await closeApp(handle)
})

const sidebarHidden = (page: Page) => page.locator('.unified-sidebar--hidden')
const needsYou = (page: Page) => page.getByRole('region', { name: 'Needs you' })
const tasks = (page: Page) => page.getByRole('region', { name: 'Tasks' })

async function branchTreeHiddenUntilRevealed(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(sidebarHidden(page)).toHaveCount(1)
  // ⌘B is a menu accelerator, which a synthesized key does not reach; Quick actions runs the same action.
  await runQuickActionFromPanel(page, 'Toggle sidebar')
  await expect(sidebarHidden(page)).toHaveCount(0)
}

async function startAgentAsking(page: Page): Promise<void> {
  await createWorkspace(page, 'Desk Repo', e2eTempDir('desk-'))
  await addAndSelectProject(page, 'Desk Repo', BRANCH)
  await runInVisibleTerminal(page, ASK_COMMAND)
}

async function questionAppearsInYourMove(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Home, 1 need you' })).toBeVisible()
  await openHome(page)
  await expect(needsYou(page).getByLabel('Terminal excerpt')).toContainText(
    'Do you want to create BoardScreen.tsx?'
  )
}

async function pressingOneAnswersIt(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Home' }).focus()
  await page.keyboard.press('1')
  await expect(needsYou(page)).toHaveCount(0)
  await expect(page.getByText('Nothing needs you.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
  await expect
    .poll(async () => (await readTerminalRows(page)).some((row) => row.includes('answered-1')))
    .toBe(true)
}

async function insightsAnswersItsQuestions(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Insights' }).click()
  for (const question of INSIGHTS_QUESTIONS) {
    await expect(page.getByText(question)).toBeVisible()
  }
  await insightsScrollsInAShortWindow(page)
  await page.getByRole('radio', { name: 'Today' }).click()
  await expect(tasks(page)).toBeVisible()
}

/** Insights is taller than a short window, so the wheel must move it; a clipped page never moves. */
async function insightsScrollsInAShortWindow(page: Page): Promise<void> {
  const before = await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize()
  )
  await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1100, 500)
  )
  try {
    const firstQuestion = page.getByText(INSIGHTS_QUESTIONS[0])
    const topBefore = (await firstQuestion.boundingBox())?.y ?? 0
    // A bare mouse move: hover() scrolls the element into view itself, even where a person cannot.
    await page.mouse.move(400, topBefore + 40)
    await page.mouse.wheel(0, 2000)
    await expect
      .poll(async () => (await firstQuestion.boundingBox())?.y ?? 0)
      .toBeLessThan(topBefore)
  } finally {
    await handle.app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
      before
    )
  }
}

async function workRowOpensItsDrawer(page: Page): Promise<void> {
  await tasks(page).getByRole('button', { name: BRANCH }).click()
  const drawer = page.getByRole('dialog', { name: BRANCH })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Open terminal' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
}

async function startWorkBeginsScratchTerminal(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Home' }).focus()
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await expect(launcher).toBeVisible()
  await launcher.getByRole('tab', { name: 'Scratch terminal' }).click()
  await page.keyboard.press('Enter')
  await expect(launcher).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
  await expectTerminalFocused(page)
}

test('an agent asks on Home, is answered there, and work is opened from the Desk', async () => {
  const { page } = handle
  await test.step('the branch tree is hidden on Home by default, and ⌘B shows it', () =>
    branchTreeHiddenUntilRevealed(page))
  await test.step('an agent starts asking a numbered question', () => startAgentAsking(page))
  await test.step('the question appears in Needs you and the Home tab says one needs you', () =>
    questionAppearsInYourMove(page))
  await test.step('pressing 1 answers it in place and the quiet line shows', () =>
    pressingOneAnswersIt(page))
  await test.step('Insights shows the questions its cards answer', () =>
    insightsAnswersItsQuestions(page))
  await test.step('a work row opens its drawer and Escape closes it', () =>
    workRowOpensItsDrawer(page))
  await test.step('⌘N opens Start work and a scratch terminal starts', () =>
    startWorkBeginsScratchTerminal(page))
})
