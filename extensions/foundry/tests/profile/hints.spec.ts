import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defaultHintsDir, evaluateHints, loadHints } from '../../src/profile/hints.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
}

describe('shipped hints', () => {
  const shipped = loadHints(defaultHintsDir())

  it('all parse and validate', () => {
    expect(shipped.problems).toEqual([])
    expect(shipped.hints.map((hint) => hint.id)).toEqual(
      expect.arrayContaining(['node', 'python', 'rust', 'go', 'make', 'github-actions', 'apple'])
    )
  })

  it('give every ecosystem file a distinct id that matches its file name', () => {
    const files = fs.readdirSync(defaultHintsDir()).map((file) => file.replace(/\.yaml$/, ''))
    expect(shipped.hints.map((hint) => hint.id).sort()).toEqual(files.sort())
  })
})

describe('loadHints', () => {
  it('reports a broken hint file and a newer schema, and still returns the good ones', () => {
    const dir = temporaryDirectory('foundry-hints')
    write(dir, 'good.yaml', 'schemaVersion: 1\nid: good\npaths: { interface: ["*.x"] }\n')
    write(dir, 'broken.yaml', 'schemaVersion: 1\nid: broken\ntools: { test: [{ command: x }] }\n')
    write(dir, 'typo.yaml', 'schemaVersion: 1\nid: typo\nscript: {}\n')
    write(dir, 'future.yaml', 'schemaVersion: 9\nid: future\n')
    write(dir, 'garbage.yaml', ': : :\n  - [')
    const loaded = loadHints(dir)
    expect(loaded.hints.map((hint) => hint.id)).toEqual(['good'])
    expect(loaded.problems).toHaveLength(4)
    expect(loaded.problems.join('\n')).toContain('broken.yaml')
    expect(loaded.problems.join('\n')).toContain('schema version 9')
  })

  it('reports a missing directory instead of throwing', () => {
    expect(loadHints('/nonexistent-hints-dir').problems).toHaveLength(1)
  })
})

describe('evaluateHints', () => {
  const { hints } = loadHints(defaultHintsDir())

  it('proposes a command with the file it read as evidence', () => {
    const repo = temporaryDirectory('foundry-hint-repo')
    write(repo, 'package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }))
    const { checks } = evaluateHints(repo, hints)
    expect(checks.lint).toMatchObject({
      command: 'npm run lint',
      source: 'hint',
      evidence: 'package.json',
    })
    expect(checks.test).toBeNull()
  })
})

describe('evaluateHints on other stacks and lockfiles', () => {
  const { hints } = loadHints(defaultHintsDir())

  it('lends only the folders and paths of a hint whose files are present', () => {
    const repo = temporaryDirectory('foundry-hint-repo')
    write(repo, 'pubspec.yaml', 'name: app\n')
    const evaluated = evaluateHints(repo, hints)
    expect(evaluated.paths.interface).toEqual(['**/*.dart'])
    expect(evaluated.paths.lockfiles).toEqual(['pubspec.lock'])
    expect(evaluated.share).toEqual([])
  })

  it('matches a root glob in a when list', () => {
    const repo = temporaryDirectory('foundry-hint-repo')
    write(repo, 'App.csproj', '<Project/>')
    expect(evaluateHints(repo, hints).paths.interface).toContain('**/*.xaml')
  })

  it('reads the install command from the lockfile, preferring pnpm', () => {
    const repo = temporaryDirectory('foundry-hint-repo')
    write(repo, 'package-lock.json', '{}')
    write(repo, 'pnpm-lock.yaml', '')
    expect(evaluateHints(repo, hints).prepare?.command).toBe('pnpm install --frozen-lockfile')
  })
})

describe('formatting files in the shipped hints', () => {
  const { hints } = loadHints(defaultHintsDir())

  it('lends the node formatting names and the rust ones, each only where its stack is present', () => {
    const node = temporaryDirectory('foundry-hint-repo')
    write(node, 'package.json', '{}')
    expect(evaluateHints(node, hints).paths.formatting).toContain('.prettierrc*')
    const rust = temporaryDirectory('foundry-hint-repo')
    write(rust, 'Cargo.toml', '[package]\n')
    expect(evaluateHints(rust, hints).paths.formatting).toEqual(['rustfmt.toml', '.rustfmt.toml'])
  })
})
