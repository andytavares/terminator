import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { availableSensors, resolveSensor } from '../../src/recipe/resolve.js'
import type { ResolveSources } from '../../src/recipe/resolve.js'

// A sensor resolves on the same three rungs as a recipe, role or rule: the
// operator's data root, the target repository's `.foundry/sensors`, then the
// built-ins that ship with the extension.

let dataRoot: string
let repo: string
let builtIn: string

function sources(): ResolveSources {
  return { dataRoot, repoPaths: [repo], builtInDir: builtIn }
}

function put(dir: string, name: string, body: string): void {
  fs.mkdirSync(path.join(dir, 'sensors'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'sensors', `${name}.yaml`), body)
}

function sensor(id: string): string {
  return `schemaVersion: 1\nid: ${id}\ndescription: x\nevery: 30m\nseverity: low\nsource:\n  kind: tracker\n  query: null\n  limit: 5\n`
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-sensors-data-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-sensors-repo-'))
  builtIn = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-sensors-built-'))
})

afterEach(() => {
  for (const dir of [dataRoot, repo, builtIn]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveSensor', () => {
  it('finds a built-in sensor when nothing else defines the id', () => {
    put(builtIn, 'direct', sensor('direct'))
    const result = resolveSensor('direct', sources())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resolved.rung).toBe('built-in')
  })

  it('lets the data root override a built-in sensor of the same id', () => {
    put(builtIn, 'direct', sensor('direct'))
    put(dataRoot, 'direct', sensor('direct'))
    const result = resolveSensor('direct', sources())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resolved.rung).toBe('data-root')
  })
})

describe('availableSensors', () => {
  it('lists every sensor across all three rungs, most specific winning', () => {
    put(builtIn, 'ci-main-red', sensor('ci-main-red'))
    put(builtIn, 'tracker-query', sensor('tracker-query'))
    put(dataRoot, 'ci-main-red', sensor('ci-main-red'))

    const found = availableSensors(sources())
    expect(found.map((s) => s.def.id).sort()).toEqual(['ci-main-red', 'tracker-query'])
    const overridden = found.find((s) => s.def.id === 'ci-main-red')
    expect(overridden?.rung).toBe('data-root')
  })

  it('skips a malformed sensor file rather than throwing', () => {
    put(builtIn, 'broken', 'schemaVersion: 1\nid: broken\nevery: 1m\nseverity: low\nsource: {}\n')
    expect(() => availableSensors(sources())).not.toThrow()
    expect(availableSensors(sources()).map((s) => s.def.id)).not.toContain('broken')
  })
})
