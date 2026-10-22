import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { withProfileEnvironment } from '../../src/profile/environment.js'
import { WorkOrderSchema } from '../../src/order/schema.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'
import { runningOrder } from '../helpers/order-parts.js'

function nodeRepository(): string {
  const repo = temporaryDirectory('foundry-environment')
  fs.writeFileSync(path.join(repo, 'package.json'), '{"scripts":{"test":"vitest run"}}')
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}')
  return repo
}

// An order written before profiles existed: its context has no environment at all.
function orderFromBeforeProfiles(repo: string) {
  const order = runningOrder('WO-OLD', ['src/a.ts'])
  const raw = JSON.parse(JSON.stringify(order))
  raw.context.repos = [{ ...raw.context.repos[0], path: repo, lane: 1 }]
  delete raw.context.environment
  return WorkOrderSchema.parse(raw)
}

describe('an order written before profiles existed', () => {
  it('gets the environment its repository resolves to when it runs', async () => {
    const repo = nodeRepository()
    const order = orderFromBeforeProfiles(repo)
    expect(order.context.environment.resolved).toBe(false)

    const filled = await withProfileEnvironment(temporaryDirectory('foundry-root'), order)

    expect(filled.context.environment.resolved).toBe(true)
    expect(filled.context.environment.share).toContain('node_modules')
    expect(filled.context.environment.prepare).toBe('npm ci')
    expect(filled.context.environment.paths.lockfiles).toContain('package-lock.json')
  })

  it('leaves an order that already carries its environment as it is', async () => {
    const repo = nodeRepository()
    const order = orderFromBeforeProfiles(repo)
    const seeded = {
      ...order,
      context: {
        ...order.context,
        environment: { ...order.context.environment, resolved: true, share: ['vendor'] },
      },
    }

    const filled = await withProfileEnvironment(temporaryDirectory('foundry-root'), seeded)

    expect(filled).toBe(seeded)
  })
})
