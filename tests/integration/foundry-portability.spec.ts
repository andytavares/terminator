import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createOrderStore } from '../../extensions/foundry/src/order/store.js'
import { createForgeChannels } from '../../extensions/foundry/src/ipc/forge-channels.js'
import { createRunChannels } from '../../extensions/foundry/src/ipc/run-channels.js'
import { probeToolchain } from '../../extensions/foundry/src/verify/toolchain-probe.js'
import type { WorkOrder } from '../../extensions/foundry/src/order/schema.js'

// The portability claim, exercised against a repository that is not this one.
//
// Every other check in the suite would pass in a repository that happens to
// have a constitution, a `.specify/` directory and a Node toolchain. This one
// runs against a scratch git repository in a different language with nothing
// in it, which is the only way to know the claim is true rather than
// convenient.
//
// It lives in the integration suite rather than under Playwright because it
// drives no interface: it is a filesystem and process test, and putting it
// behind a browser runner would have bought nothing but a slower loop.

const builtInDir = path.resolve(__dirname, '../../extensions/foundry')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

let repo: string
let dataRoot: string

function forge() {
  return createForgeChannels({
    store: createOrderStore(dataRoot),
    now: () => new Date().toISOString(),
  })
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-portability-'))
  git(repo, 'init', '--quiet')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repo, 'main.py'), 'def greet():\n    return "hi"\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'init')
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-portability-data-'))
})

afterEach(() => {
  // `maxRetries` because removing a git working tree on macOS intermittently
  // reports ENOTEMPTY while the filesystem catches up. Node retries the
  // unlink itself; without it this teardown is flaky rather than the test
  // being wrong.
  for (const dir of [repo, dataRoot]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

describe('Foundry in a repository it has never seen', () => {
  it('seeds an order with no setup step of any kind', async () => {
    const result = (await forge().create({
      source: { kind: 'typed', text: 'add a docstring to greet' },
      repoPaths: [repo],
    })) as { order: WorkOrder }

    expect(result.order.status).toBe('draft')
    expect(result.order.intent.problem).toContain('docstring')
  })

  it('reports every check as unavailable rather than assuming a toolchain', async () => {
    const result = (await forge().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as { order: WorkOrder; unavailableChecks: string[] }

    // A Python file with no pytest config, no package.json, no Makefile and no
    // CI workflow: there is genuinely nothing to run here, and saying so is
    // the right answer rather than guessing at a command.
    expect(result.unavailableChecks).toHaveLength(6)
    expect(Object.values(result.order.context.toolchain).every((v) => v === null)).toBe(true)
  })

  it('carries no house documents from a repository that has none', async () => {
    const result = (await forge().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as { order: WorkOrder }
    expect(result.order.context.houseDocs).toEqual([])
  })

  it('does not offer the specification pipeline where the toolkit is absent', async () => {
    const store = createOrderStore(dataRoot)
    const seeded = (await forge().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as { order: WorkOrder }

    const runs = createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => new Date().toISOString(),
    })
    const offered = (await runs.recipes({ id: seeded.order.id })) as {
      recipes: { name: string; available: boolean; unmet: string[] }[]
    }

    const speckit = offered.recipes.find((r) => r.name === 'speckit')
    expect(speckit?.available).toBe(false)
    expect(speckit?.unmet.join(' ')).toContain('.specify')

    // And the shapes that need nothing are still on offer, so the repository
    // is usable rather than merely refused.
    expect(offered.recipes.find((r) => r.name === 'direct')?.available).toBe(true)
  })

  it('leaves the repository exactly as it found it', async () => {
    await forge().create({ source: { kind: 'typed', text: 'x' }, repoPaths: [repo] })
    probeToolchain(repo)

    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
    expect(fs.existsSync(path.join(repo, '.foundry'))).toBe(false)
  })

  it('never touches the repository .gitignore', async () => {
    const before = fs.existsSync(path.join(repo, '.gitignore'))
    await forge().create({ source: { kind: 'typed', text: 'x' }, repoPaths: [repo] })
    expect(fs.existsSync(path.join(repo, '.gitignore'))).toBe(before)
  })

  it('keeps every record under the configured location', async () => {
    const seeded = (await forge().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as { order: WorkOrder }

    const orderPath = path.join(dataRoot, 'orders', seeded.order.id)
    for (const file of ['order.json', 'order.md', 'ledger.jsonl']) {
      expect(fs.existsSync(path.join(orderPath, file)), file).toBe(true)
    }
  })

  it('runs a complete intake without the repository ever being written to', async () => {
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    const seeded = (await forge().create({
      source: { kind: 'typed', text: 'add a docstring' },
      repoPaths: [repo],
    })) as { order: WorkOrder }
    await forge().compile({ id: seeded.order.id, commit: false })

    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
  })
})
