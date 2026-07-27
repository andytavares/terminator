import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  lstatSync,
  readFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { materializeWorktree } from '../../../../../src/main/supervision/worktree/materialize.js'

let root: string
let primary: string
let worktree: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'materialize-'))
  primary = join(root, 'primary')
  worktree = join(root, 'wt')
  mkdirSync(primary, { recursive: true })
  mkdirSync(worktree, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const run = (symlink: string[] = [], copy: string[] = []) =>
  materializeWorktree({ primaryPath: primary, worktreePath: worktree, symlink, copy })

describe('sharing heavy directories (FR-031)', () => {
  it('symlinks rather than copying, which is the whole point', () => {
    mkdirSync(join(primary, 'node_modules', 'pkg'), { recursive: true })
    const result = run(['node_modules'])
    expect(result.linked).toEqual(['node_modules'])
    expect(lstatSync(join(worktree, 'node_modules')).isSymbolicLink()).toBe(true)
  })

  it('makes the shared contents reachable through the link', () => {
    mkdirSync(join(primary, 'node_modules'), { recursive: true })
    writeFileSync(join(primary, 'node_modules', 'marker.txt'), 'hello')
    run(['node_modules'])
    expect(readFileSync(join(worktree, 'node_modules', 'marker.txt'), 'utf-8')).toBe('hello')
  })

  it('creates intermediate directories for a nested share', () => {
    mkdirSync(join(primary, 'packages', 'app', 'node_modules'), { recursive: true })
    expect(run(['packages/app/node_modules']).linked).toEqual(['packages/app/node_modules'])
  })

  it('records a skip when the directory is absent from the primary checkout', () => {
    const result = run(['node_modules'])
    expect(result.linked).toEqual([])
    // Recorded, never silent: this is why the worktree looks thinner than expected.
    expect(result.skipped[0]).toMatchObject({ path: 'node_modules' })
    expect(result.skipped[0].reason).toContain('not present')
  })

  it('records a skip rather than clobbering something already in the worktree', () => {
    mkdirSync(join(primary, 'node_modules'), { recursive: true })
    mkdirSync(join(worktree, 'node_modules'), { recursive: true })
    expect(run(['node_modules']).skipped[0].reason).toContain('already exists')
  })

  it('shares several directories in one pass', () => {
    for (const d of ['node_modules', 'target', '.venv']) mkdirSync(join(primary, d))
    expect(run(['node_modules', 'target', '.venv']).linked).toHaveLength(3)
  })
})

describe('copying declared files (FR-032)', () => {
  it('copies rather than links, so the worktree gets its own', () => {
    writeFileSync(join(primary, '.env.local'), 'TOKEN=abc')
    const result = run([], ['.env.local'])
    expect(result.copied).toEqual(['.env.local'])
    expect(lstatSync(join(worktree, '.env.local')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(worktree, '.env.local'), 'utf-8')).toBe('TOKEN=abc')
  })

  it('creates intermediate directories for a nested file', () => {
    mkdirSync(join(primary, 'certs'), { recursive: true })
    writeFileSync(join(primary, 'certs', 'dev.pem'), 'cert')
    expect(run([], ['certs/dev.pem']).copied).toEqual(['certs/dev.pem'])
    expect(existsSync(join(worktree, 'certs', 'dev.pem'))).toBe(true)
  })

  it('records a skip when the file is absent', () => {
    expect(run([], ['.env.local']).skipped[0]).toMatchObject({ path: '.env.local' })
  })
})

describe('doing nothing', () => {
  it('is valid to declare neither, which is the default config', () => {
    expect(run()).toEqual({ linked: [], copied: [], skipped: [] })
  })
})

// Every failure here is one the operator has to see: a worktree that silently
// lost its .env is worse than one that reported it could not copy it.

describe('when the filesystem refuses', () => {
  it('reports a symlink it could not create rather than throwing', () => {
    mkdirSync(join(primary, 'node_modules'), { recursive: true })
    // The target path exists as a file, so creating the parent directory for
    // the link fails.
    writeFileSync(join(worktree, 'node_modules'), 'not a directory')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = materializeWorktree({
      primaryPath: primary,
      worktreePath: join(worktree, 'node_modules', 'nested'),
      symlink: ['node_modules'],
      copy: [],
    })
    expect(result.linked).toEqual([])
    expect(result.skipped[0].path).toBe('node_modules')
    expect(result.skipped[0].reason).toBeTruthy()
  })

  it('reports a file it could not copy rather than throwing', () => {
    writeFileSync(join(primary, '.env.local'), 'TOKEN=1')
    writeFileSync(join(worktree, 'blocked'), 'not a directory')
    const result = materializeWorktree({
      primaryPath: primary,
      worktreePath: join(worktree, 'blocked', 'nested'),
      symlink: [],
      copy: ['.env.local'],
    })
    expect(result.copied).toEqual([])
    expect(result.skipped[0].path).toBe('.env.local')
    expect(result.skipped[0].reason).toBeTruthy()
  })

  it('symlinks a file as a file, not as a directory', () => {
    writeFileSync(join(primary, 'dev.pem'), 'cert')
    const result = materializeWorktree({
      primaryPath: primary,
      worktreePath: worktree,
      symlink: ['dev.pem'],
      copy: [],
    })
    expect(result.linked).toEqual(['dev.pem'])
    expect(lstatSync(join(worktree, 'dev.pem')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(worktree, 'dev.pem'), 'utf-8')).toBe('cert')
  })
})
