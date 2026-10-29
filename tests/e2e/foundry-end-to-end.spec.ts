import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { launchApp, closeApp, createWorkspace, e2eTempDir, type AppHandle } from './helpers'
import { startGithubStub, type GithubStub } from './github-stub'
import { extensionPage, type ExtensionView } from './extension-page'
import {
  createTypedOrder,
  git,
  makeFixtureRepo,
  listOrdersInForge,
  openFoundry,
  openListedOrder,
} from './foundry-harness'

// Foundry from an idea to a draft pull request, with nothing real behind it but the app:
// the stub `claude` (fixtures/acp-stub-agent.mjs) answers as the real adapter does, `gh` is
// the stub GitHub (github-stub.ts), and `origin` is a local bare repository the push reaches.

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string
let foundry: ExtensionView

test.beforeAll(async () => {
  // Unresolved on purpose: the temp folder sits under macOS's /var symlink, which git lists resolved.
  repo = makeFixtureRepo('foundry-end-to-end-repo-')
  bare = e2eTempDir('foundry-end-to-end-origin-')
  git(bare, 'init', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'push', '--quiet', '-u', 'origin', 'main')
  stub = await startGithubStub({ bareRepo: bare })
  handle = await launchApp(undefined, { ...stub.env, E2E_AGENT_BUILDS: '1' })
  await createWorkspace(handle.page, 'Foundry End To End', repo)
  await openFoundry(handle)
  foundry = await extensionPage(handle, 'foundry')
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

test('an idea becomes a plan, is handed off, and ends as a draft pull request', async () => {
  const id = await createTypedOrder(handle, {
    repo,
    text: 'add a document that says what the stub changed',
    missing: 'the order was not created',
  })
  await listOrdersInForge(handle, id)
  await openListedOrder(handle, id)

  await foundry.getByRole('button', { name: 'Draft the plan' }).first().click()
  await expect(foundry.getByRole('button', { name: /^Plan.*1 unit/ })).toBeVisible()
  await expect(foundry.getByRole('button', { name: /^Red team/ })).toContainText(
    'Clean after round 1'
  )

  await foundry.getByRole('button', { name: 'Hand off with Direct' }).click()

  await expect.poll(() => stub.pullRequests.length).toBe(1)
  expect(stub.pullRequests[0].isDraft).toBe(true)
  expect(git(bare, 'rev-parse', '--verify', stub.pullRequests[0].headRefName)).not.toBe('')
  // The line finished: the operator is asked to take the draft out of draft.
  await expect(foundry.getByText(/Mark the draft for .* ready\?/).first()).toBeVisible()
  expect(stub.calls.some((call) => call.args.slice(0, 2).join(' ') === 'pr create')).toBe(true)
})
