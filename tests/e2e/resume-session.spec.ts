import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
  e2eTempDir,
} from './helpers'
import { expectTerminalFocused, openOverview } from './session-views'

// Resume against the running app. A conversation is reported exactly as the
// capture hook reports one — a file in the profile's agent-sessions directory —
// so the whole path from report to control is exercised without running an
// agent. Pressing Resume against a real agent is tests/e2e/live/resume-live.spec.ts.
// Resume is on the Overview wall's tiles; the Desk lists no ended session.

/** The two terminals on the branch: the first's transcript is there, the second's never was. */
interface Conversations {
  folder: string
  transcript: string
  first: string
  second: string
}

/** Back to the terminal, which Home and the wall cover while one of them is showing. */
async function goToTerminal(page: Page): Promise<void> {
  await selectProject(page, 'Repo One', 'feature-a')
  await expect(page.locator('.terminal-pane').filter({ visible: true }).first()).toBeVisible()
}

/** What the capture hook writes when an agent reports a conversation. */
function reportConversation(
  profile: string,
  terminalSessionId: string,
  report: { conversationId: string; transcriptPath: string }
): void {
  const dir = join(profile, 'agent-sessions')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `${terminalSessionId}.json`)
  // Written aside and renamed into place, as the hook does
  // (src/main/agents/agent-session-hook.ts): the watcher consumes a report as
  // soon as its name appears, and one written in place could be read empty.
  const { conversationId, transcriptPath } = report
  writeFileSync(
    `${target}.tmp`,
    JSON.stringify({
      terminal: terminalSessionId,
      provider: 'claude',
      sessionId: conversationId,
      transcriptPath,
      cwd: dirname(transcriptPath),
      source: 'startup',
      at: new Date().toISOString(),
    })
  )
  renameSync(`${target}.tmp`, target)
}

/** The ids of the session records written so far, oldest first. */
function recordIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { data } = await window.electronAPI.sessionRecords.list()
    return data.map((r) => r.sessionId)
  })
}

/**
 * Describes the session in the tab at `index` and returns the id of the terminal it is.
 *
 * Learned the way anything else would: describe the session, then read the
 * record that description created. The capture hook learns it from the
 * environment instead, which no browser context can see.
 */
async function describeAndLearnId(page: Page, tab: { index: number; text: string }) {
  const before = await recordIds(page)
  await page.locator('.tab-bar__tab--session').nth(tab.index).click({ button: 'right' })
  await page.locator('.ctx-menu').getByRole('button', { name: 'Add description…' }).click()
  const box = page.getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill(tab.text)
  await box.press('Enter')
  await expect.poll(async () => (await recordIds(page)).length).toBe(before.length + 1)
  return (await recordIds(page)).find((id) => !before.includes(id))!
}

/** The agent conversation a terminal's record holds, or null. */
function conversationOf(page: Page, sessionId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const { data } = await window.electronAPI.sessionRecords.list()
    return data.find((r) => r.sessionId === id)?.agent?.sessionId ?? null
  }, sessionId)
}

function resumeButtons(page: Page) {
  return page.getByRole('button', { name: /^Resume/ })
}

/** A second terminal on the branch, from the tab bar. */
async function openSecondTerminal(page: Page): Promise<void> {
  await goToTerminal(page)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(2)
}

/** Two terminals on the one branch, each reporting its own conversation. The report names the
 * terminal it ran in, which is the whole of the pairing — nothing depends on how the agent started. */
async function twoConversationsPairWithTheirSessions(
  handle: AppHandle,
  run: Conversations
): Promise<void> {
  const { page, userDataDir } = handle
  await goToTerminal(page)
  run.first = await describeAndLearnId(page, { index: 0, text: 'resume test' })
  reportConversation(userDataDir, run.first, {
    conversationId: 'conv-first',
    transcriptPath: run.transcript,
  })
  await openSecondTerminal(page)
  run.second = await describeAndLearnId(page, { index: 1, text: 'the other one' })
  reportConversation(userDataDir, run.second, {
    conversationId: 'conv-second',
    transcriptPath: join(run.folder, 'missing.jsonl'),
  })
  await expect.poll(() => conversationOf(page, run.first), { timeout: 15_000 }).toBe('conv-first')
  await expect.poll(() => conversationOf(page, run.second), { timeout: 15_000 }).toBe('conv-second')
}

/** Ends the terminal in the tab at `index` the way an agent ending would. */
async function exitTerminal(page: Page, index: number): Promise<void> {
  await goToTerminal(page)
  await page.locator('.tab-bar__tab--session').nth(index).click()
  await page.locator('.terminal-pane').filter({ visible: true }).click()
  // Typing 'exit' before the terminal owns focus lets the keys land on the
  // page instead of the shell, which never sees 'exit' and never closes —
  // exactly the silent failure that made Resume never appear.
  await expectTerminalFocused(page)
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await openOverview(page)
}

async function goneTranscriptSaysSo(page: Page): Promise<void> {
  await exitTerminal(page, 1)
  await expect(page.getByText('Conversation no longer available')).toBeVisible({ timeout: 15_000 })
  await expect(resumeButtons(page)).toHaveCount(0)
}

async function stoppedSessionOffersResume(page: Page): Promise<void> {
  await exitTerminal(page, 0)
  await expect(resumeButtons(page)).toHaveCount(1, { timeout: 15_000 })
}

// Whether a transcript is there is only true as of the moment it was read, and
// the agent owns that file: it can go while the wall is on screen. Coming back to
// the wall has to ask again, or the operator is offered a button that cannot work.
async function goneWhileRunningStopsBeingOffered(page: Page, run: Conversations): Promise<void> {
  rmSync(run.transcript)
  await goToTerminal(page)
  await openOverview(page)
  await expect(page.getByText('Conversation no longer available')).toHaveCount(2)
  await expect(resumeButtons(page)).toHaveCount(0)
}

/** Resumes the stopped conversation from the keyboard, with a focus ring to show
 * where it is: this is the one control that brings work back, and it must not
 * need a mouse. */
async function resumeFromKeyboard(page: Page, run: Conversations): Promise<void> {
  writeFileSync(run.transcript, '{}\n')
  await goToTerminal(page)
  await openOverview(page)
  const resume = resumeButtons(page)
  await expect(resume).toHaveCount(1, { timeout: 15_000 })
  await resume.focus()
  expect(
    await resume.evaluate((el) => getComputedStyle(el, ':focus-visible').outlineWidth)
  ).not.toBe('0px')
  await page.keyboard.press('Enter')
  // The terminal that took the conversation over carries its description.
  await expect(page.locator('.tab-bar__tab--session[title="resume test"]')).toBeVisible()
}

async function firstRun(handle: AppHandle, run: Conversations): Promise<void> {
  const { page } = handle
  await createWorkspace(page, 'Repo One', run.folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openOverview(page)
  await test.step('before anything is reported there is nothing to resume', () =>
    expect(resumeButtons(page)).toHaveCount(0))
  await test.step('two conversations on one branch each come back to their own session', () =>
    twoConversationsPairWithTheirSessions(handle, run))
  await openOverview(page)
  await test.step('a running session offers nothing to resume', () =>
    expect(resumeButtons(page)).toHaveCount(0))
  await test.step('a conversation whose transcript has gone says so instead', () =>
    goneTranscriptSaysSo(page))
  await test.step('a stopped session offers Resume once its conversation is known', () =>
    stoppedSessionOffersResume(page))
  await test.step('a conversation that goes while the app is running stops being offered', () =>
    goneWhileRunningStopsBeingOffered(page, run))
  await test.step('a conversation that is back is resumed from the keyboard on its branch', () =>
    resumeFromKeyboard(page, run))
}

test('a conversation is resumed, and only when it can be', async () => {
  test.setTimeout(120_000)
  const folder = e2eTempDir('resume-')
  const run: Conversations = {
    folder,
    transcript: join(folder, 'conv.jsonl'),
    first: '',
    second: '',
  }
  writeFileSync(run.transcript, '{}\n')
  const handle = await launchApp()
  try {
    await firstRun(handle, run)
  } finally {
    await closeApp(handle)
  }
})
