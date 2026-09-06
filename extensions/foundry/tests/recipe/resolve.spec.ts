import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  resolveFile,
  resolveRecipe,
  availableNames,
  loadAllRules,
} from '../../src/recipe/resolve.js'
import type { ResolveSources } from '../../src/recipe/resolve.js'
import { checkRequirements } from '../../src/recipe/requirements.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Three rungs, most specific first. The middle one — a definition carried by
// the repository being worked on — is what lets a team ship a house recipe
// with its code without Foundry ever requiring a repository to have one.

let dataRoot: string
let repo: string
let builtIn: string

function sources(): ResolveSources {
  return { dataRoot, repoPaths: [repo], builtInDir: builtIn }
}

function put(dir: string, kind: string, name: string, body: string): void {
  fs.mkdirSync(path.join(dir, kind), { recursive: true })
  fs.writeFileSync(path.join(dir, kind, `${name}.yaml`), body)
}

function recipe(id: string, extra = ''): string {
  return `schemaVersion: 1\nid: ${id}\n${extra}steps:\n  - id: a\n    kind: run\n    command: make\n`
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-data-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-repo-'))
  builtIn = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-built-'))
})

afterEach(() => {
  for (const dir of [dataRoot, repo, builtIn]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveFile', () => {
  it('finds a built-in when nothing else defines the name', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    expect(resolveFile('recipes', 'direct', sources())?.rung).toBe('built-in')
  })

  it('lets a repository override a built-in', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    put(path.join(repo, '.foundry'), 'recipes', 'direct', recipe('direct'))
    expect(resolveFile('recipes', 'direct', sources())?.rung).toBe('repository')
  })

  it('lets the operator override everything', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    put(path.join(repo, '.foundry'), 'recipes', 'direct', recipe('direct'))
    put(dataRoot, 'recipes', 'direct', recipe('direct'))
    expect(resolveFile('recipes', 'direct', sources())?.rung).toBe('data-root')
  })

  it('accepts a .yml file as readily as .yaml', () => {
    fs.mkdirSync(path.join(builtIn, 'recipes'), { recursive: true })
    fs.writeFileSync(path.join(builtIn, 'recipes', 'direct.yml'), recipe('direct'))
    expect(resolveFile('recipes', 'direct', sources())).not.toBeNull()
  })

  it('returns nothing for a name nobody defines', () => {
    expect(resolveFile('recipes', 'nowhere', sources())).toBeNull()
  })

  it('never requires a repository to carry a .foundry directory', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    expect(resolveFile('recipes', 'direct', sources())).not.toBeNull()
    expect(fs.existsSync(path.join(repo, '.foundry'))).toBe(false)
  })

  it('creates nothing in the repository while resolving', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    const before = fs.readdirSync(repo)
    resolveFile('recipes', 'direct', sources())
    expect(fs.readdirSync(repo)).toEqual(before)
  })
})

describe('resolveRecipe', () => {
  it('parses and reports which rung it came from', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    const r = resolveRecipe('direct', sources())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.resolved.value.id).toBe('direct')
      expect(r.resolved.rung).toBe('built-in')
    }
  })

  it('reports a malformed override by path rather than falling through to the built-in', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    put(dataRoot, 'recipes', 'direct', 'id: [unclosed\n')
    const r = resolveRecipe('direct', sources())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('direct.yaml')
  })

  it('reports a name nobody defines', () => {
    const r = resolveRecipe('nowhere', sources())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('nowhere')
  })
})

describe('availableNames', () => {
  it('is the union across the three rungs, without duplicates', () => {
    put(builtIn, 'recipes', 'direct', recipe('direct'))
    put(builtIn, 'recipes', 'bugfix', recipe('bugfix'))
    put(dataRoot, 'recipes', 'direct', recipe('direct'))
    put(path.join(repo, '.foundry'), 'recipes', 'house', recipe('house'))
    expect(availableNames('recipes', sources())).toEqual(['bugfix', 'direct', 'house'])
  })

  it('is empty when nothing is defined anywhere', () => {
    expect(availableNames('recipes', sources())).toEqual([])
  })
})

describe('loadAllRules', () => {
  const rule = (id: string) =>
    `schemaVersion: 1\nid: ${id}\nscope: universal\nrung: L2\nasserts: something\n`

  it('loads every rule that parses', () => {
    put(builtIn, 'rules', 'exit-code', rule('exit-code'))
    put(builtIn, 'rules', 'coverage', rule('coverage'))
    expect(
      loadAllRules(sources())
        .rules.map((r) => r.id)
        .sort()
    ).toEqual(['coverage', 'exit-code'])
  })

  it('reports a broken rule without losing the good ones', () => {
    put(builtIn, 'rules', 'good', rule('good'))
    put(builtIn, 'rules', 'broken', 'scope: [unclosed\n')
    const loaded = loadAllRules(sources())
    expect(loaded.rules.map((r) => r.id)).toEqual(['good'])
    expect(loaded.problems).toHaveLength(1)
  })
})

describe('checkRequirements', () => {
  function order(over: Partial<WorkOrder> = {}): WorkOrder {
    const base = draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: [repo],
      now: '2026-09-06T10:00:00.000Z',
    })
    return { ...base, ...over }
  }

  it('offers a recipe with no requirements', () => {
    expect(checkRequirements([], order()).available).toBe(true)
  })

  it('withholds a recipe whose required path is absent, and says which repository', () => {
    const r = checkRequirements([{ kind: 'path_exists', value: '.specify' }], order())
    expect(r.available).toBe(false)
    expect(r.unmet[0]).toContain('.specify')
  })

  it('offers it once the path exists', () => {
    fs.mkdirSync(path.join(repo, '.specify'), { recursive: true })
    expect(checkRequirements([{ kind: 'path_exists', value: '.specify' }], order()).available).toBe(
      true
    )
  })

  it('withholds a recipe needing a toolchain command this repository lacks', () => {
    const r = checkRequirements([{ kind: 'toolchain', value: 'test' }], order())
    expect(r.available).toBe(false)
    expect(r.unmet[0]).toContain('no test command')
  })

  it('offers it once the probe found that command', () => {
    const o = order()
    o.context.toolchain.test = { command: 'npm test', source: 'package.json' }
    expect(checkRequirements([{ kind: 'toolchain', value: 'test' }], o).available).toBe(true)
  })

  it('rejects an unknown toolchain check rather than treating it as met', () => {
    expect(checkRequirements([{ kind: 'toolchain', value: 'vibes' }], order()).available).toBe(
      false
    )
  })

  it('compares repository counts', () => {
    expect(checkRequirements([{ kind: 'repos', value: '>1' }], order()).available).toBe(false)
    expect(checkRequirements([{ kind: 'repos', value: '>=1' }], order()).available).toBe(true)
    expect(checkRequirements([{ kind: 'repos', value: '1' }], order()).available).toBe(true)
  })

  it('treats an unknown requirement kind as unmet, never as satisfied', () => {
    const r = checkRequirements([{ kind: 'phase_of_moon', value: 'full' }], order())
    expect(r.available).toBe(false)
    expect(r.unmet[0]).toContain('phase_of_moon')
  })

  it('reports every unmet requirement, not just the first', () => {
    const r = checkRequirements(
      [
        { kind: 'path_exists', value: '.specify' },
        { kind: 'toolchain', value: 'test' },
      ],
      order()
    )
    expect(r.unmet).toHaveLength(2)
  })
})
