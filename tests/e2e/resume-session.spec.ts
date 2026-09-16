import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
} from './helpers'

// Resume against the running app. A conversation is reported exactly as the
// capture hook reports one — a file in the profile's agent-sessions directory —
// so the whole path from report to control is exercised without running an
// agent. Pressing Resume against a real agent is tests/e2e/live/resume-live.spec.ts.

let handle: AppHandle | undefined
let folder: string
let transcript: string

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'resume-'))
  transcript = join(folder, 'conversation.jsonl')
  writeFileSync(transcript, '{}\n')
})

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
  rmSync(folder, { recursive: true, force: true })
})

/** Back to the terminal, which Home covers while it is showing. */
async function goToTerminal(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) === 'page') await entry.click()
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
}

async function openHome(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

/** What the capture hook writes when an agent reports a conversation. */
function reportConversation(
  profile: string,
  terminalSessionId: string,
  conversationId: string,
  transcriptPath: string
): void {
  const dir = join(profile, 'agent-sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${terminalSessionId}.json`),
    JSON.stringify({
      terminal: terminalSessionId,
      provider: 'claude',
      sessionId: conversationId,
      transcriptPath,
      cwd: folder,
      source: 'startup',
      at: new Date().toISOString(),
    })
  )
}

/**
 * The id of the terminal the app has open.
 *
 * Learned the way anything else would: describe the session, then read the
 * record that description created. The capture hook learns it from the
 * environment instead, which no browser context can see.
 */
async function openTerminalId(page: Page, group: string): Promise<string> {
  const box = page
    .getByRole('rowgroup', { name: group })
    .getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill('resume test')
  await box.press('Enter')
  return page.evaluate(async () => {
    const { data } = await window.electronAPI.sessionRecords.list()
    return data[0].sessionId
  })
}

test('a stopped session offers Resume once its conversation is known', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')

  // Before anything is reported there is nothing to resume.
  await openHome(page)
  await expect(page.getByRole('button', { name: /^Resume/ })).toHaveCount(0)

  const terminalId = await openTerminalId(page, 'Repo One / feature-a')
  reportConversation(handle.userDataDir, terminalId, 'conv-e2e-1', transcript)

  // A running session still offers nothing: there is nothing to bring back.
  await expect(page.getByRole('button', { name: /^Resume/ })).toHaveCount(0)

  // End the agent's terminal the way an agent ending would.
  await goToTerminal(page)
  await page.locator('.terminal-pane').click()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await openHome(page)
  await expect(page.getByRole('button', { name: /^Resume/ }).first()).toBeVisible({
    timeout: 15_000,
  })
})

test('a conversation whose transcript has gone says so instead', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  const terminalId = await openTerminalId(page, 'Repo One / feature-a')
  reportConversation(handle.userDataDir, terminalId, 'conv-e2e-2', join(folder, 'missing.jsonl'))

  await goToTerminal(page)
  await page.locator('.terminal-pane').click()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await openHome(page)

  await expect(page.getByText('Conversation no longer available').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: /^Resume/ })).toHaveCount(0)
})

test('a conversation from the last run is offered under Closed, and nothing restarted itself', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  reportConversation(
    profile,
    await openTerminalId(page, 'Repo One / feature-a'),
    'conv-e2e-3',
    transcript
  )
  // Give the sweep time to fold the report into the session's record.
  await page.waitForTimeout(1500)

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  const restarted = handle.page
  await openHome(restarted)

  // SC-007: a restart starts no agents on its own.
  await expect(restarted.getByRole('rowgroup', { name: 'Closed' })).toBeVisible()
  await expect(restarted.locator('.tab-bar__tab--session')).toHaveCount(0)
  await expect(
    restarted.getByRole('rowgroup', { name: 'Closed' }).getByRole('button', { name: /^Resume/ })
  ).toBeVisible()

  // And the branch it belonged to is still the one it would come back in.
  await selectProject(restarted, 'Repo One', 'feature-a')

  // Resuming it takes it out of the history: it is a live session again, not a
  // live session beside a ghost of itself.
  await openHome(restarted)
  await restarted
    .getByRole('rowgroup', { name: 'Closed' })
    .getByRole('button', { name: /^Resume/ })
    .click()
  // The terminal that took the conversation over carries its description.
  await expect(restarted.locator('.tab-bar__tab--session[title="resume test"]')).toBeVisible()
  await openHome(restarted)
  await expect(restarted.getByRole('rowgroup', { name: 'Closed' })).toHaveCount(0)
})

test('two conversations on one branch each come back to their own session', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  const second = join(folder, 'second.jsonl')
  writeFileSync(second, '{}\n')

  // Two terminals on the one branch, each reporting its own conversation. The
  // report names the terminal it ran in, which is the whole of the pairing —
  // nothing here depends on how the agent was started.
  await openHome(page)
  const first = await openTerminalId(page, 'Repo One / feature-a')
  reportConversation(profile, first, 'conv-first', transcript)
  await goToTerminal(page)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await openHome(page)
  const box = page
    .getByRole('rowgroup', { name: 'Repo One / feature-a' })
    .getByRole('textbox', { name: 'What is this session doing?' })
    .last()
  await box.fill('the other one')
  await box.press('Enter')
  const ids = await page.evaluate(async () => {
    const { data } = await window.electronAPI.sessionRecords.list()
    return data.map((r) => r.sessionId)
  })
  const other = ids.find((id) => id !== first)!
  reportConversation(profile, other, 'conv-second', second)
  await page.waitForTimeout(1500)

  const conversationOf = async (sessionId: string): Promise<string | null> =>
    page.evaluate(async (id) => {
      const { data } = await window.electronAPI.sessionRecords.list()
      return data.find((r) => r.sessionId === id)?.agent?.sessionId ?? null
    }, sessionId)

  expect(await conversationOf(first)).toBe('conv-first')
  expect(await conversationOf(other)).toBe('conv-second')
})
