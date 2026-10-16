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
import { expectTerminalFocused, openHome } from './session-views'

// Resume against the running app. A conversation is reported exactly as the
// capture hook reports one — a file in the profile's agent-sessions directory —
// so the whole path from report to control is exercised without running an
// agent. Pressing Resume against a real agent is tests/e2e/live/resume-live.spec.ts.

const BRANCH_GROUP = 'Repo One / feature-a'

/** The two terminals on the branch: the first's transcript is there, the second's never was. */
interface Conversations {
  folder: string
  transcript: string
  first: string
  second: string
}

/** Back to the terminal, which Home covers while it is showing. */
async function goToTerminal(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) === 'page') await entry.click()
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

/** The ids of the records Home has written, oldest first. */
function recordIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { data } = await window.electronAPI.sessionRecords.list()
    return data.map((r) => r.sessionId)
  })
}

/**
 * Describes the last session on the branch and returns the id of the terminal it is.
 *
 * Learned the way anything else would: describe the session, then read the
 * record that description created. The capture hook learns it from the
 * environment instead, which no browser context can see.
 */
async function describeAndLearnId(page: Page, description: string): Promise<string> {
  const before = await recordIds(page)
  const box = page
    .getByRole('rowgroup', { name: BRANCH_GROUP })
    .getByRole('textbox', { name: 'What is this session doing?' })
    .last()
  await box.fill(description)
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
  await openHome(page)
}

/** Two terminals on the one branch, each reporting its own conversation. The report names the
 * terminal it ran in, which is the whole of the pairing — nothing depends on how the agent started. */
async function twoConversationsPairWithTheirSessions(
  handle: AppHandle,
  run: Conversations
): Promise<void> {
  const { page, userDataDir } = handle
  run.first = await describeAndLearnId(page, 'resume test')
  reportConversation(userDataDir, run.first, {
    conversationId: 'conv-first',
    transcriptPath: run.transcript,
  })
  await openSecondTerminal(page)
  run.second = await describeAndLearnId(page, 'the other one')
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
  await openHome(page)
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
// the agent owns that file: it can go while Home is on screen. Coming back to
// Home has to ask again, or the operator is offered a button that cannot work.
async function goneWhileRunningStopsBeingOffered(page: Page, run: Conversations): Promise<void> {
  rmSync(run.transcript)
  await goToTerminal(page)
  await openHome(page)
  await expect(page.getByText('Conversation no longer available')).toHaveCount(2)
  await expect(resumeButtons(page)).toHaveCount(0)
}

async function firstRun(handle: AppHandle, run: Conversations): Promise<void> {
  const { page } = handle
  await createWorkspace(page, 'Repo One', run.folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await test.step('before anything is reported there is nothing to resume', () =>
    expect(resumeButtons(page)).toHaveCount(0))
  await test.step('two conversations on one branch each come back to their own session', () =>
    twoConversationsPairWithTheirSessions(handle, run))
  await test.step('a running session offers nothing to resume', () =>
    expect(resumeButtons(page)).toHaveCount(0))
  await test.step('a conversation whose transcript has gone says so instead', () =>
    goneTranscriptSaysSo(page))
  await test.step('a stopped session offers Resume once its conversation is known', () =>
    stoppedSessionOffersResume(page))
  await test.step('a conversation that goes while the app is running stops being offered', () =>
    goneWhileRunningStopsBeingOffered(page, run))
}

/** Resumes the closed conversation from the keyboard, with a focus ring to show
 * where it is: this is the one control that brings work back, and it must not
 * need a mouse. */
async function resumeFromKeyboard(page: Page): Promise<void> {
  const resume = page.getByRole('rowgroup', { name: 'Closed' }).getByRole('button', {
    name: /^Resume/,
  })
  await resume.focus()
  expect(
    await resume.evaluate((el) => getComputedStyle(el, ':focus-visible').outlineWidth)
  ).not.toBe('0px')
  await page.keyboard.press('Enter')
}

async function offeredUnderClosedAfterRestart(page: Page): Promise<void> {
  await openHome(page)
  const closed = page.getByRole('rowgroup', { name: 'Closed' })
  // SC-007: a restart starts no agents on its own.
  await expect(closed).toBeVisible()
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(0)
  await expect(closed.getByRole('button', { name: /^Resume/ })).toBeVisible()
}

/** Resuming takes it out of the history: a live session again, not one beside a ghost of itself. */
async function resumedOnItsBranch(page: Page): Promise<void> {
  // The branch it belonged to is still the one it would come back in.
  await selectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await resumeFromKeyboard(page)
  // The terminal that took the conversation over carries its description.
  await expect(page.locator('.tab-bar__tab--session[title="resume test"]')).toBeVisible()
  await openHome(page)
  const closed = page.getByRole('rowgroup', { name: 'Closed' })
  await expect(closed.getByText('the other one')).toBeVisible()
  await expect(closed.getByText('resume test')).toHaveCount(0)
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
  let handle: AppHandle | undefined = await launchApp()
  try {
    const profile = handle.userDataDir
    await firstRun(handle, run)
    // The transcript is back, so the conversation can be offered after the restart.
    writeFileSync(run.transcript, '{}\n')
    await closeApp(handle)
    handle = undefined
    handle = await launchApp(profile)
    const { page } = handle
    await test.step('a conversation from the last run is offered under Closed, and nothing restarted itself', () =>
      offeredUnderClosedAfterRestart(page))
    await test.step('resuming it from the keyboard brings it back on its branch', () =>
      resumedOnItsBranch(page))
  } finally {
    await closeApp(handle)
  }
})
