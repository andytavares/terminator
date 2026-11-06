import { test, expect } from '@playwright/test'
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
 * and records every prompt with the mime types of its images. */

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

async function startAgentFromAPrompt(): Promise<void> {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  await launcher.getByLabel('Search tickets or type a prompt').fill('Add a retry to fetchUser')
  await launcher.getByRole('checkbox', { name: 'Use the repo folder' }).check()
  await launcher
    .getByRole('button', { name: /^Start/ })
    .last()
    .click()
  await expect(launcher).toBeHidden()
  await expect.poll(() => prompts().length).toBe(1)
}

async function aMessageTypedDuringATurnWaitsInTheQueue(): Promise<void> {
  const { page } = handle
  const box = page.getByLabel('Message the agent')
  await expect(box).toBeEnabled()
  await box.fill('Also cover the 429 case')
  await box.press('Enter')
  await expect(page.getByText('1 message sends when this turn ends')).toBeVisible()
  expect(prompts()).toHaveLength(1)
}

async function anAttachedImageReachesTheAgent(): Promise<void> {
  const { page } = handle
  await page.getByRole('button', { name: 'Stop' }).click()
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
