import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// An option whose default throws is a required dependency wearing an
// optional's clothes. `git` was one: it was declared optional for tests, its
// default threw "git worktree operations were not provided", and the
// composition root never passed it — so starting an agent failed at the first
// provision, in production only, with a stack trace in a log nobody reads.
//
// This asserts the composition root supplies every such dependency. It is a
// source scan rather than a boot, because booting Electron here is not worth
// the seconds and the failure it catches is entirely structural.

const root = join(__dirname, '../../..')
const service = readFileSync(join(root, 'src/main/supervision/supervision-service.ts'), 'utf-8')
const index = readFileSync(join(root, 'src/main/index.ts'), 'utf-8')

/** Options whose fallback throws instead of degrading. */
function optionsWithThrowingDefaults(): string[] {
  const found = new Set<string>()
  // `options.x ?? (…throw…)` and `const x = options.x ?? { …throw… }`
  for (const match of service.matchAll(
    /options\.(\w+)\s*\?\?([\s\S]{0,400}?)(?=\n\n|\n {2}const |\n {2}\})/g
  )) {
    if (/\bthrow new Error\b/.test(match[2])) found.add(match[1])
  }
  return [...found]
}

function passedByCompositionRoot(): Set<string> {
  const start = index.indexOf('createSupervisionService({')
  const call = index.slice(start, index.indexOf('\n  })', start))
  return new Set([...call.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]))
}

describe('the composition root supplies what cannot degrade', () => {
  it('finds the options whose defaults throw, so this test cannot silently pass', () => {
    // If this ever drops to zero the scan has stopped matching and the
    // assertion below would be vacuous.
    expect(optionsWithThrowingDefaults().length).toBeGreaterThan(0)
  })

  it('passes every one of them', () => {
    const passed = passedByCompositionRoot()
    const missing = optionsWithThrowingDefaults().filter((option) => !passed.has(option))
    expect(missing).toEqual([])
  })

  it('passes the git worktree operations by name', () => {
    // The specific regression: provisioning could never succeed without it.
    expect(passedByCompositionRoot().has('git')).toBe(true)
  })
})
