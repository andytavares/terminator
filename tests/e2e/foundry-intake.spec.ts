import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import {
  foundryChannel,
  hasLaunchScript,
  launchScript,
  makeFixtureRepo,
  openFoundry,
} from './foundry-harness'

// Foundry's intake path: an idea becomes an order, the order compiles or says
// why it can't, and — the claim the whole Line rests on — a seeded draft's
// architect actually launches as a real agent, in a real terminal, in its own
// worktree.
//
// Split out of what used to be `foundry.spec.ts` (see
// docs/research/e2e-deterministic-selective.md) — this file's own app and
// fixture repo, and every test seeds its own order rather than relying on
// another test's, so running any one of them alone asserts the same thing as
// running the suite.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = makeFixtureRepo('foundry-intake-repo-')
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Intake', repo)
  await openFoundry(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

test('an idea becomes an order the Forge can show', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'rows are clipped at the right edge of src/terminal/row.ts' },
    repoPaths: [repo],
  })) as { order?: { id: string; status: string }; error?: string }

  expect(created.error).toBeUndefined()
  expect(created.order?.status).toBe('draft')

  const listed = (await foundryChannel(handle, 'foundry:order.list')) as {
    orders: { id: string }[]
  }
  expect(listed.orders.map((o) => o.id)).toContain(created.order?.id)
})

test('the repository is read before the operator is asked anything', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'the lint command is wrong' },
    repoPaths: [repo],
  })) as { order: { context: { toolchain: Record<string, unknown> } }; unavailableChecks: string[] }

  // The fixture declares `test` and `lint`, so those are probed and the rest
  // are honestly reported as unmeasurable here.
  expect(created.order.context.toolchain.test).toMatchObject({ source: 'package.json' })
  expect(created.unavailableChecks).toContain('coverage')
})

test('an incomplete order is refused, and says what is missing', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'something vague' },
    repoPaths: [repo],
  })) as { order: { id: string } }

  const compiled = (await foundryChannel(handle, 'foundry:order.compile', {
    id: created.order.id,
    commit: true,
  })) as { order: { status: string }; compile: { ok: boolean; failures: { check: string }[] } }

  expect(compiled.compile.ok).toBe(false)
  expect(compiled.order.status).toBe('draft')
  expect(compiled.compile.failures.length).toBeGreaterThan(0)
})

test('a run cannot be started from an order nobody agreed', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'start me without agreeing' },
    repoPaths: [repo],
  })) as { order: { id: string } }

  const started = (await foundryChannel(handle, 'foundry:run.start', { id: created.order.id })) as {
    error?: string
  }
  expect(started.error).toBeDefined()
})

test('the ledger records what happened, attributably', async () => {
  await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'something to record' },
    repoPaths: [repo],
  })

  const record = (await foundryChannel(handle, 'foundry:ledger.query', {})) as {
    entries: { actor: string; action: string; reason: string }[]
    actions: string[]
  }
  expect(record.actions).toContain('order.seeded')
  for (const entry of record.entries) {
    expect(entry.actor, 'an unattributed entry is not a record of a decision').not.toBe('')
    expect(entry.action).not.toBe('')
  }
})

test('the curator proposes nothing from a record with no repetition in it', async () => {
  await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'nothing repeated here' },
    repoPaths: [repo],
  })
  const proposals = (await foundryChannel(handle, 'foundry:rules.propose', {})) as {
    proposals: unknown[]
  }
  expect(proposals.proposals).toEqual([])
})

test('Foundry changes nothing in the repository it works on', async () => {
  // The claim the whole portability story rests on, checked against a real
  // repository after real orders have been created in it by the tests above.
  //
  // The one thing it may leave is its own records directory, and only when the
  // default location is in use — which is exactly what ADR-042 says the
  // default costs, and what the setting avoids. Everything else is a failure:
  // no modified file, no deleted file, no new file of any other kind, and
  // above all no `.gitignore` entry, because editing that would be changing a
  // file no order asked to change.
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString()
  const left = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => line !== '?? .foundry/')

  expect(left, `Foundry left files behind:\n${status}`).toEqual([])

  const ignore = execFileSync('git', ['ls-files', '.gitignore'], { cwd: repo }).toString()
  expect(ignore.trim(), 'Foundry created a .gitignore').toBe('')
})

/**
 * The claim the whole Line rests on: a unit runs as a real agent, in a real
 * terminal, in its own worktree, and you can see it.
 *
 * A seeded draft has a problem statement and no criteria and no plan, so the
 * compile gate refuses it for ever. Something has to turn that into a plan,
 * and that something is an agent — the only route to a runnable order is
 * hand-writing its JSON otherwise.
 *
 * `claude` is stubbed on PATH by `launchApp` (see `tests/e2e/helpers.ts`), so
 * this never starts a real model: the stub prints its argv and idles until
 * killed, and what is under test is the launch itself, not anything an agent
 * decides to do.
 */
test('intake launches the architect read-only in the order’s own project, and delete removes it', async () => {
  test.setTimeout(180_000)
  const { page } = handle

  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'greet should take a name, in README.md' },
    repoPaths: [repo],
  })) as { order: { id: string; acceptance: unknown[] } }

  // A seeded draft has nothing to hand off. That is the state intake exists
  // to move, and asserting it here is what makes the next assertion mean
  // something.
  expect(created.order.acceptance).toEqual([])

  const converged = (await foundryChannel(handle, 'foundry:order.converge', {
    id: created.order.id,
  })) as { error?: string }
  // It either ran or said why. Silence would be the bug. `converge` resolves
  // once the scout session has started, not once its whole turn ends — a
  // stubbed or a real `claude` may still be running when this returns.
  expect(converged).not.toBeNull()

  // One project for the order (ADR-061): named with the branch its lanes will
  // use, and no separate intake project beside it.
  const branch = `foundry/${created.order.id.toLowerCase()}`
  const project = page.locator('.branch-row__name').filter({ hasText: branch })
  await expect(project).toHaveCount(1, { timeout: 60_000 })
  await expect(page.locator('.branch-row__name').filter({ hasText: 'intake' })).toHaveCount(0)
  await project.click()

  // What the launch actually wrote, not the terminal's visible scrollback — a
  // talkative agent scrolls the typed line out of view, which is a fact about
  // the terminal, not about whether the launch happened.
  await expect.poll(() => hasLaunchScript(handle), { timeout: 60_000 }).toBe(true)
  const launched = launchScript(handle)
  expect(launched).toContain('claude --session-id')
  // Never the thing this replaced: an invisible agent approving its own calls.
  expect(launched).not.toContain('bypassPermissions')
  // A relative settings path resolves against the worktree, where it does not
  // exist, and the run dies on "Settings file not found".
  expect(launched).toMatch(/--settings '\//)
  // And it does not carry the parent Claude Code session in with it.
  expect(launched).toMatch(/^unset .*CLAUDE_CODE_BRIDGE_SESSION_ID/m)

  // The architect reads the order's lane checkout — the tree the builder
  // will change — cut under the data root, not inside the repository.
  const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  expect(worktrees).toContain(join('.foundry', 'orders', created.order.id, 'worktrees'))
  expect(worktrees).toContain(`[${branch}]`)

  // Deleting the order takes its project with the checkout.
  const deleted = (await foundryChannel(handle, 'foundry:order.delete', {
    id: created.order.id,
  })) as { removed?: string[] }
  expect(deleted.removed).toContain(`the project ${branch}`)
  await expect(project).toHaveCount(0, { timeout: 30_000 })
})
