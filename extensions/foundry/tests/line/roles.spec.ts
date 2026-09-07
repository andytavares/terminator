import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoleRegistry, ResumeForbiddenError } from '../../src/line/roles.js'
import type { ResolveSources } from '../../src/recipe/resolve.js'

// The single most important invariant in the whole design lives here: a
// verifier may not resume a conversation. The builder's justification is in
// that context window, and asking a model to ignore what it can see is not a
// control — refusing to start the run is.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let dataRoot: string
let repo: string

function sources(): ResolveSources {
  return { dataRoot, repoPaths: [repo], builtInDir }
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-roles-data-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-roles-repo-'))
})

afterEach(() => {
  for (const dir of [dataRoot, repo]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('createRoleRegistry', () => {
  it('finds a built-in role', () => {
    expect(createRoleRegistry(sources()).get('builder')?.id).toBe('builder')
  })

  it('is null for a role nobody defines', () => {
    expect(createRoleRegistry(sources()).get('nonesuch')).toBeNull()
  })

  it('lets the operator override a built-in role', () => {
    fs.mkdirSync(path.join(dataRoot, 'roles'), { recursive: true })
    fs.writeFileSync(
      path.join(dataRoot, 'roles', 'builder.yaml'),
      'schemaVersion: 1\nid: builder\nmodelTier: fast\nprompt: mine\n'
    )
    expect(createRoleRegistry(sources()).get('builder')?.modelTier).toBe('fast')
  })
})

describe('assertResumable', () => {
  it('permits a role that may resume', () => {
    expect(() => createRoleRegistry(sources()).assertResumable('builder', 'sess-1')).not.toThrow()
  })

  it('refuses to resume a verifier', () => {
    expect(() => createRoleRegistry(sources()).assertResumable('verifier', 'sess-1')).toThrow(
      ResumeForbiddenError
    )
  })

  it('refuses to resume the red team or the inspector either', () => {
    const registry = createRoleRegistry(sources())
    for (const role of ['red-team', 'inspector']) {
      expect(() => registry.assertResumable(role, 'sess-1')).toThrow(ResumeForbiddenError)
    }
  })

  it('says why, so the refusal is not a mystery in a log', () => {
    expect(() => createRoleRegistry(sources()).assertResumable('verifier', 's')).toThrow(
      /already been persuaded/
    )
  })

  it('permits any role when there is no session to resume', () => {
    const registry = createRoleRegistry(sources())
    for (const role of ['verifier', 'red-team', 'inspector', 'builder']) {
      expect(() => registry.assertResumable(role, undefined)).not.toThrow()
    }
  })

  it('treats an unknown role as non-resumable, so a typo cannot open the hole', () => {
    expect(() => createRoleRegistry(sources()).assertResumable('verifer', 'sess-1')).toThrow(
      ResumeForbiddenError
    )
  })
})

// `mayUseTool` takes the tool's own name, because that is what a hook is
// handed. The role file's vocabulary is on the other side of the mapping.
describe('tool and write permissions', () => {
  it('lets a builder edit', () => {
    expect(createRoleRegistry(sources()).mayUseTool('builder', 'Edit')).toBe(true)
  })

  it('does not let a verifier edit', () => {
    expect(createRoleRegistry(sources()).mayUseTool('verifier', 'Edit')).toBe(false)
  })

  it('refuses every writing tool to a role that did not declare editing', () => {
    const registry = createRoleRegistry(sources())
    for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) {
      expect(registry.mayUseTool('red-team', tool), tool).toBe(false)
    }
  })

  it('allows a tool the vocabulary says nothing about, rather than refusing everything', () => {
    // Refusing every unlisted tool would refuse the ones every agent uses to
    // think — Read, Grep, TodoWrite — none of which a role file enumerates.
    expect(createRoleRegistry(sources()).mayUseTool('verifier', 'Read')).toBe(true)
    expect(createRoleRegistry(sources()).mayUseTool('verifier', 'Bash')).toBe(true)
  })

  it('grants an unknown role no tool at all', () => {
    expect(createRoleRegistry(sources()).mayUseTool('nonesuch', 'Read')).toBe(false)
  })

  it('reports which roles may write', () => {
    const registry = createRoleRegistry(sources())
    expect(registry.mayWrite('builder')).toBe(true)
    expect(registry.mayWrite('verifier')).toBe(false)
    expect(registry.mayWrite('inspector')).toBe(false)
  })
})

// `writes:` says what a role produces, not where. The red team produces
// findings, the foreman a schedule, the architect a plan — none of them
// touches the repository, and all three came back as "may write" because the
// check was `writes.length > 0`. The executor installs its read-only policy on
// that answer, so the adversarial pass could edit the code it was reviewing.
describe('who may write to the checkout', () => {
  it('is the three roles whose writes land in a working copy', () => {
    const registry = createRoleRegistry(sources())
    expect(registry.mayWrite('builder')).toBe(true)
    expect(registry.mayWrite('integrator')).toBe(true)
    expect(registry.mayWrite('scribe')).toBe(true)
  })

  it('is not a role that produces an artefact but touches no file', () => {
    const registry = createRoleRegistry(sources())
    for (const role of ['red-team', 'foreman', 'architect', 'scout']) {
      expect(registry.mayWrite(role), role).toBe(false)
    }
  })

  it('is not a role that writes nothing at all', () => {
    const registry = createRoleRegistry(sources())
    expect(registry.mayWrite('verifier')).toBe(false)
    expect(registry.mayWrite('inspector')).toBe(false)
  })

  it('agrees with what the built-in role files declare', () => {
    // The same set the built-ins spec asserts, checked through the registry
    // the executor actually asks.
    const registry = createRoleRegistry(sources())
    const writers = [
      'architect',
      'builder',
      'foreman',
      'inspector',
      'integrator',
      'red-team',
      'scout',
      'scribe',
      'verifier',
    ].filter((role) => registry.mayWrite(role))
    expect(writers.sort()).toEqual(['builder', 'integrator', 'scribe'])
  })
})
