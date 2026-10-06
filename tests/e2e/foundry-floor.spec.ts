import { test, expect } from '@playwright/test'
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import {
  bodyText,
  captureFoundry,
  clickByName,
  foundryChannel,
  inFoundry,
  makeFixtureRepo,
  openFoundry,
} from './foundry-harness'

// The Floor's live CI band and the Ledger's Factory metrics: numbers read
// back from what was actually recorded, not from the call that seeded them.
//
// Split out of what used to be `foundry.spec.ts` (see
// docs/research/e2e-deterministic-selective.md) — this file's own app and
// fixture repo, and every test seeds its own order and navigates to it
// itself, rather than relying on what an earlier test left on screen.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = makeFixtureRepo('foundry-floor-repo-')
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Floor', repo)
  await openFoundry(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

async function openOrderRow(id: string, listShot?: string): Promise<string> {
  expect(await clickByName(handle, 'button', 'Forge')).toBe(true)
  await expect
    .poll(() => bodyText(handle), { timeout: 15_000 })
    .toMatch(/New order|Steps|All orders/)
  await clickByName(handle, 'button', 'All orders')
  await expect
    .poll(
      () =>
        inFoundry<boolean>(
          handle,
          `(function () {
        var all = document.querySelectorAll('button')
        for (var i = 0; i < all.length; i++) {
          if ((all[i].textContent || '').indexOf(${JSON.stringify(id)}) !== -1) return true
        }
        return false
      })()`
        ),
      { timeout: 15_000 }
    )
    .toBe(true)
  if (listShot !== undefined) await captureFoundry(handle, listShot)
  const list = await bodyText(handle)
  const opened = await inFoundry<boolean>(
    handle,
    `(function () {
    var all = document.querySelectorAll('button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf(${JSON.stringify(id)}) !== -1) {
        all[i].click()
        return true
      }
    }
    return false
  })()`
  )
  expect(opened, `no row for ${id} in the Forge`).toBe(true)
  return list
}

test('a draft’s CI is on the Floor while it is watched', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'a draft whose CI is being watched' },
    repoPaths: [repo],
  })) as { order?: { id: string } }
  const id = created.order?.id as string
  expect(id, 'no order was created').toBeTruthy()

  const dir = join(repo, '.foundry', 'orders', id)
  const file = join(dir, 'order.json')
  writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), status: 'running' })
  )
  const node = (nodeId: string, kind: string, role: string | null, lane: number | null) => ({
    id: nodeId,
    stepId: nodeId.split(':')[0],
    kind,
    state: 'passed',
    unitIds: [],
    lane,
    role,
    dependsOn: [],
    attempts: 1,
    reworks: 0,
    feedback: [],
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
  })
  writeFileSync(
    join(dir, 'run-graph.json'),
    JSON.stringify({
      orderId: id,
      recipe: 'direct',
      nodes: [node('build:lane-1', 'fanout', 'builder', 1), node('ship', 'gate', null, null)],
    })
  )
  // The draft this run opened, as shipping records it.
  writeFileSync(
    join(dir, 'pulls.json'),
    JSON.stringify([
      {
        lane: 1,
        repo: 'r',
        cwd: repo,
        branch: 'foundry/ci-watched',
        url: 'https://github.com/o/r/pull/7',
        bodyPath: join(dir, 'pull-request-lane-1.md'),
      },
    ])
  )
  const link = (run: number) => `https://github.com/o/r/actions/runs/${run}/job/1`
  writeFileSync(
    join(dir, 'ci.json'),
    JSON.stringify({
      round: 1,
      max: 2,
      status: 'watching',
      pulls: [
        {
          url: 'https://github.com/o/r/pull/7',
          checks: [
            { name: 'Test', bucket: 'fail', link: link(1), workflow: 'CI' },
            { name: 'Lint', bucket: 'pass', link: link(1), workflow: 'CI' },
            { name: 'E2E', bucket: 'pending', link: link(1), workflow: 'CI' },
          ],
        },
      ],
      reason: '',
      at: new Date().toISOString(),
    })
  )

  // The order's row says the same as its Floor before it is opened: the pull
  // request, and the CI round with a spinner while the checks run.
  const list = await openOrderRow(id, 'order-list-ci.png')
  expect(list).toContain('#7')
  expect(list).toContain('Fix 1 of 2')

  const band = () =>
    inFoundry<string>(
      handle,
      `(function () {
    var h = document.getElementById('fdry-ci-h')
    return h && h.closest('section') ? h.closest('section').innerText : ''
  })()`
    )
  await expect.poll(band, { timeout: 15_000 }).toContain('Fix 1 of 2')
  expect(await band()).toContain('Test')

  await captureFoundry(handle, 'floor-ci.png')
})

test('the Ledger’s Factory tab reads the numbers off what was recorded', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'a shipped order to measure' },
    repoPaths: [repo],
  })) as { order?: { id: string } }
  const id = created.order?.id as string
  expect(id, 'no order was created to measure').toBeTruthy()

  // What a run that shipped first time leaves behind: started, then a draft
  // thirty minutes after the order was seeded, with nothing sent back.
  const seededAt = Date.now()
  const entry = (minutes: number, action: string): string =>
    JSON.stringify({
      at: new Date(seededAt + minutes * 60_000).toISOString(),
      orderId: id,
      actor: 'rule:line',
      action,
      subject: id,
      reason: 'seeded by the test',
      evidence: [],
    })
  appendFileSync(
    join(repo, '.foundry', 'orders', id, 'ledger.jsonl'),
    [entry(10, 'run.started'), entry(30, 'ship.draft_opened')].map((line) => `${line}\n`).join('')
  )

  await openFoundry(handle)
  expect(await clickByName(handle, 'button', 'Ledger')).toBe(true)
  await expect.poll(() => clickByName(handle, 'button', 'Factory'), { timeout: 15_000 }).toBe(true)

  const tiles = () =>
    inFoundry<Record<string, string>>(
      handle,
      `(function () {
    var out = {}
    document.querySelectorAll('.fdry-metrics-tile').forEach(function (tile) {
      var label = tile.querySelector('.fdry-metrics-tile__label')
      out[(label && label.textContent) || ''] = tile.textContent.replace(label ? label.textContent : '', '').trim()
    })
    return out
  })()`
    )
  await expect.poll(async () => (await tiles()).Shipped, { timeout: 15_000 }).toBe('1')
  const finalTiles = await tiles()
  expect(finalTiles['First-pass yield']).toBe('100%')
  expect(finalTiles['Median lead time']).toBe('30 min')
  expect(await bodyText(handle)).toContain('a shipped order to measure')

  await captureFoundry(handle, 'ledger-factory.png')

  // And on the factory site's status wall.
  expect(await clickByName(handle, 'button', 'Forge')).toBe(true)
  expect(await clickByName(handle, 'button', 'Factory view')).toBe(true)
  const wall = () =>
    inFoundry<string>(
      handle,
      `(function () {
    var wall = document.querySelector('[aria-label="Status wall"]')
    return wall ? wall.innerText : ''
  })()`
    )
  await expect.poll(wall, { timeout: 15_000 }).toContain('First-pass yield')
  await captureFoundry(handle, 'site-status-wall.png')
  // Back to the list, tidying up after itself.
  expect(await clickByName(handle, 'button', 'List view')).toBe(true)
})
