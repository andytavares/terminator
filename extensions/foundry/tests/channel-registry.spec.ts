import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Every channel is registered once.
//
// The host refuses a second handler for the same name by throwing, and that
// throw happens inside `activate` — so one duplicated line does not break one
// channel, it stops the whole extension loading. Nothing else catches it: the
// build succeeds, every unit test passes, and the extension is simply absent
// from the application.
//
// A duplicate `reg()` did exactly that, and the only thing that noticed was a
// screenshot with no Foundry button in it.

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'src', 'index.ts'), 'utf8')

const contract = fs.readFileSync(
  path.join(
    here,
    '..',
    '..',
    '..',
    'specs',
    '037-foundry-software-factory',
    'contracts',
    'ipc-channels.md'
  ),
  'utf8'
)

function registered(): string[] {
  return [...src.matchAll(/reg\(api,\s*'([^']+)'/g)].map((m) => m[1])
}

describe('the channel registry', () => {
  it('registers every channel exactly once', () => {
    const names = registered()
    const seen = new Map<string, number>()
    for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1)
    const twice = [...seen].filter(([, n]) => n > 1).map(([name]) => name)

    expect(twice, `registered more than once: ${twice.join(', ')}`).toEqual([])
  })

  it('registers something at all, so this test cannot pass by finding nothing', () => {
    expect(registered().length).toBeGreaterThan(20)
  })

  // Constitution VIII: the contract ships with the code. It said "ten
  // channels" while forty-three were registered, and thirty of them were
  // documented nowhere — a contract nobody could use to answer "what does this
  // extension expose".
  it('documents every channel it registers', () => {
    const undocumented = registered().filter((name) => !contract.includes(name))
    expect(undocumented, `not in the IPC contract: ${undocumented.join(', ')}`).toEqual([])
  })

  it('names every channel under this extension prefix', () => {
    for (const name of registered()) {
      expect(name.startsWith('foundry:'), `${name} is not a foundry channel`).toBe(true)
    }
  })
})
