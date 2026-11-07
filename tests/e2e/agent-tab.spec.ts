import { test, expect, type Locator } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  agentRecordFile,
  closeApp,
  createWorkspace,
  e2eTempDir,
  launchApp,
  type AppHandle,
} from './helpers'
import { makeRepoWithRemote } from './git-harness'

/** The stub ACP agent (fixtures/acp-stub-agent.mjs) keeps each turn open until it is cancelled,
 * and records every prompt with its text and the mime types of its images. */

let handle: AppHandle
let repo: string
let bare: string

// The smallest valid PNG: one transparent pixel.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

interface PromptRecord {
  kind: string
  sessionId: string
  text: string
  images?: string[]
}

function prompts(): PromptRecord[] {
  const file = agentRecordFile(handle.userDataDir)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PromptRecord)
    .filter((record) => record.kind === 'prompt')
}

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-agent-tab'))
  handle = await launchApp(e2eTempDir('agent-tab-'))
  await createWorkspace(handle.page, 'agents', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  for (const dir of [repo, bare]) rmSync(dir, { recursive: true, force: true })
})

/** The Repeat form is the tallest Start work gets: its button stays in the window and the divider
 *  (the side column's left border) runs down to the footer. Then back to Now. */
async function aRepeatKeepsScheduleOnScreen(): Promise<void> {
  const launcher = handle.page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('radio', { name: 'Repeat' }).click()
  await launcher.getByRole('button', { name: 'Every 30 min' }).click()
  await expect(launcher.getByRole('button', { name: /^Schedule/ })).toBeInViewport()
  const side = await launcher.locator('.start-work__side').boundingBox()
  const footer = await launcher.locator('.start-work__footer').boundingBox()
  expect(Math.abs((side?.y ?? 0) + (side?.height ?? 0) - (footer?.y ?? -10))).toBeLessThan(2)
  await launcher.getByRole('radio', { name: 'Now' }).click()
}

async function startAgentFromAPrompt(): Promise<void> {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  // Before typing: a prompt on a branch of its own asks the agent to name it, which the stub
  // records as one more prompt.
  const before = prompts().length
  await launcher.getByRole('checkbox', { name: 'Use the repo folder' }).check()
  await launcher.getByLabel('What should it do?').fill('Add a retry to fetchUser')
  await aRepeatKeepsScheduleOnScreen()
  await launcher
    .getByRole('button', { name: /^Start/ })
    .last()
    .click()
  await expect(launcher).toBeHidden()
  await expect.poll(() => prompts().length).toBe(before + 1)
}

async function aMessageTypedDuringATurnWaitsInTheQueue(): Promise<void> {
  const { page } = handle
  const box = page.getByLabel('Message the agent')
  await expect(box).toBeEnabled()
  const sent = prompts().length
  await box.fill('Also cover the 429 case')
  await box.press('Enter')
  await expect(page.getByText('1 message sends when this turn ends')).toBeVisible()
  expect(prompts()).toHaveLength(sent)
}

async function anAttachedImageReachesTheAgent(): Promise<void> {
  const { page } = handle
  await page.getByRole('button', { name: 'Stop' }).click()
  // Enter during a turn queues text only, so wait until the turn has ended.
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden()
  await page.getByLabel('Attach an image').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  await expect(page.getByText('pixel.png')).toBeVisible()
  const box = page.getByLabel('Message the agent')
  await box.fill('Match this')
  await box.press('Enter')
  await expect.poll(() => prompts().at(-1)?.images).toEqual(['image/png'])
}

test('the agent tab queues, and sends an image', async () => {
  await test.step('a prompt run as an agent opens an agent tab', startAgentFromAPrompt)
  await test.step(
    'a message typed while the turn runs waits in the queue above the box',
    aMessageTypedDuringATurnWaitsInTheQueue
  )
  await test.step(
    'an attached image reaches the agent as an image block',
    anAttachedImageReachesTheAgent
  )
})

/** Starts an agent on `prompt` in the repo folder; returns its tab's session id and title, once
 *  its tab is the active one and the stub has answered. */
async function startAgent(prompt: string): Promise<{ sessionId: string; title: string }> {
  const { page } = handle
  const tabs = page.locator('[data-session-tab]')
  const before = await tabs.evaluateAll((all) => all.map((tab) => tab.dataset.sessionTab))
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  await launcher.getByRole('checkbox', { name: 'Use the repo folder' }).check()
  await launcher.getByLabel('What should it do?').fill(prompt)
  await launcher
    .getByRole('button', { name: /^Start/ })
    .last()
    .click()
  await expect(launcher).toBeHidden()
  const active = page.locator('.tab-bar__tab--active[data-session-tab]')
  await expect
    .poll(async () => before.includes(String(await active.getAttribute('data-session-tab'))))
    .toBe(false)
  await expect(page.locator('.agent-message--agent')).toBeVisible()
  const sessionId = (await active.getAttribute('data-session-tab')) ?? ''
  const title = (await active.locator('.tab-bar__title').textContent()) ?? ''
  return { sessionId, title }
}

/** Drags a tab with the pointer, as the tab bar follows it (src/renderer/terminal/tab-drag.ts). */
async function dragTabOnto(tab: Locator, target: Locator): Promise<void> {
  const { page } = handle
  const from = await tab.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('the tab or its target is not on screen')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
}

/** Selects the first `text` in the agent's reply, as the operator would with the mouse. */
async function selectInReply(text: string): Promise<void> {
  await handle.page.locator('.agent-message--agent').evaluate((reply, wanted) => {
    const walker = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(wanted) ?? -1
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + wanted.length)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error(`the reply has no "${wanted}"`)
  }, text)
}

type AgentTab = { sessionId: string; title: string }

const composerOf = (tab: AgentTab): Locator =>
  handle.page.locator(`[data-context-drop="${tab.sessionId}"]`)

async function aTabDroppedOnTheComposerIsAttached(dragged: AgentTab, target: AgentTab) {
  const composer = composerOf(target)
  await dragTabOnto(handle.page.locator(`[data-session-tab="${dragged.sessionId}"]`), composer)
  await expect(composer.locator('.agent-context-chip')).toContainText(dragged.title)
}

async function aCitedPassageWaitsInTheComposer(target: AgentTab) {
  const { page } = handle
  await selectInReply('acp-stub')
  await page.getByRole('button', { name: 'Cite' }).click()
  const comment = page.getByLabel('Comment on this quote')
  await comment.fill('Say this more plainly')
  await comment.press('Enter')
  await expect(composerOf(target).locator('.agent-context-chip--citation')).toContainText(
    'acp-stub'
  )
}

async function theContextFollowsTheTypedText(dragged: AgentTab, target: AgentTab) {
  const { page } = handle
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden()
  const box = page.getByLabel('Message the agent')
  await box.fill('Use the attached context')
  await box.press('Enter')
  const sent = (): string =>
    prompts()
      .filter((record) => record.sessionId === target.sessionId)
      .at(-1)?.text ?? ''
  await expect.poll(sent).toContain('<citations>')
  const text = sent()
  expect(text.startsWith('Use the attached context\n\n<terminator_context>\n')).toBe(true)
  expect(text).toContain(`title="${dragged.title}"`)
  expect(text).toContain('<quote>acp-stub</quote>\n<comment>Say this more plainly</comment>')
  await expect(page.locator('.agent-message--user').last()).toHaveText('Use the attached context')
}

test('a dragged session and a cited reply reach the agent after the typed text', async () => {
  const dragged = await startAgent('Rename parseInvoice to readInvoice')
  const target = await startAgent('Document the invoice reader')
  await test.step('a tab dropped on the composer shows as a session chip', () =>
    aTabDroppedOnTheComposerIsAttached(dragged, target))
  await test.step('a passage of the reply cited with a comment shows as a citation chip', () =>
    aCitedPassageWaitsInTheComposer(target))
  await test.step('the prompt carries both after the typed text; the bubble shows only it', () =>
    theContextFollowsTheTypedText(dragged, target))
})
