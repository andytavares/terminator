import { describe, it, expect, beforeEach } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { restack } from '../../src/line/restack.js'
import type { ExecResult, ShellExec } from '../../src/line/integrate.js'

// Real git in temp dirs, never the real repository. A known hazard: unscrubbed
// GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE from the outer test run leak into
// whatever `cwd` git is given, so every git call here goes through `gitIn`,
// which strips them and sets a local identity.

const exec: ShellExec = ({ command, args, cwd }) =>
  new Promise<ExecResult>((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ exitCode: code, stdout, stderr, timedOut: false })
    })
  })

function gitIn(cwd: string, ...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd, env, stdio: 'pipe' })
}

function initIdentity(cwd: string): void {
  gitIn(cwd, 'config', 'user.name', 'Test')
  gitIn(cwd, 'config', 'user.email', 'test@example.com')
}

let origin: string
let lane: string
let other: string

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-restack-'))
  origin = path.join(root, 'origin.git')
  lane = path.join(root, 'lane')
  other = path.join(root, 'other')

  fs.mkdirSync(origin)
  gitIn(origin, 'init', '--bare', '-b', 'main')

  // Seed origin via a throwaway clone, so the bare repo starts with a commit.
  const seed = path.join(root, 'seed')
  gitIn(root, 'clone', origin, seed)
  initIdentity(seed)
  fs.writeFileSync(path.join(seed, 'file.txt'), 'line one\nline two\nline three\n')
  gitIn(seed, 'add', '-A')
  gitIn(seed, 'commit', '-m', 'seed')
  gitIn(seed, 'push', 'origin', 'main')

  gitIn(root, 'clone', origin, lane)
  initIdentity(lane)
  gitIn(lane, 'checkout', '-b', 'lane/1')
  gitIn(lane, 'push', 'origin', 'lane/1')

  gitIn(root, 'clone', origin, other)
  initIdentity(other)
})

describe('restack', () => {
  it('rebases and pushes when the base moved without overlap', async () => {
    // A commit on the lane branch that does not touch main's change.
    fs.appendFileSync(path.join(lane, 'lane-only.txt'), 'lane work\n')
    gitIn(lane, 'add', '-A')
    gitIn(lane, 'commit', '-m', 'lane work')
    gitIn(lane, 'push', 'origin', 'lane/1')

    // The predecessor merges: a non-overlapping change lands on main.
    fs.writeFileSync(path.join(other, 'main-only.txt'), 'main work\n')
    gitIn(other, 'add', '-A')
    gitIn(other, 'commit', '-m', 'predecessor merged')
    gitIn(other, 'push', 'origin', 'main')

    const result = await restack({ cwd: lane, branch: 'lane/1', base: 'main' }, exec)

    expect(result).toEqual({ kind: 'rebased', pushed: true })

    const remoteLog = execIn(lane, ['log', '--oneline', 'origin/lane/1'])
    expect(remoteLog).toContain('predecessor merged')
    expect(remoteLog).toContain('lane work')
  })

  it('aborts and reports the conflicting file when the same line changed on both sides', async () => {
    // The lane edits line one.
    fs.writeFileSync(path.join(lane, 'file.txt'), 'lane change\nline two\nline three\n')
    gitIn(lane, 'add', '-A')
    gitIn(lane, 'commit', '-m', 'lane edits line one')
    gitIn(lane, 'push', 'origin', 'lane/1')

    // The predecessor also edits line one, on main.
    fs.writeFileSync(path.join(other, 'file.txt'), 'main change\nline two\nline three\n')
    gitIn(other, 'add', '-A')
    gitIn(other, 'commit', '-m', 'predecessor edits line one')
    gitIn(other, 'push', 'origin', 'main')

    const headBefore = gitRevParse(lane, 'HEAD')

    const result = await restack({ cwd: lane, branch: 'lane/1', base: 'main' }, exec)

    expect(result).toEqual({ kind: 'conflict', files: ['file.txt'] })

    const status = execIn(lane, ['status'])
    expect(status).not.toContain('rebase in progress')
    expect(gitRevParse(lane, 'HEAD')).toBe(headBefore)
  })

  it('fails when the force-with-lease is refused because origin moved underneath it', async () => {
    // Someone else pushes a new commit to the lane branch on origin, out from
    // under the local clone's tracking ref.
    gitIn(other, 'fetch', 'origin', 'lane/1')
    gitIn(other, 'checkout', 'lane/1')
    fs.writeFileSync(path.join(other, 'stolen.txt'), 'someone else pushed this\n')
    gitIn(other, 'add', '-A')
    gitIn(other, 'commit', '-m', 'someone else pushed this')
    gitIn(other, 'push', 'origin', 'lane/1')

    // A non-overlapping commit on the lane so the rebase itself is clean.
    fs.appendFileSync(path.join(lane, 'lane-only.txt'), 'lane work\n')
    gitIn(lane, 'add', '-A')
    gitIn(lane, 'commit', '-m', 'lane work')

    const result = await restack({ cwd: lane, branch: 'lane/1', base: 'main' }, exec)

    expect(result.kind).toBe('failed')
  })

  it('fails when origin is unreachable', async () => {
    fs.rmSync(origin, { recursive: true, force: true })

    const result = await restack({ cwd: lane, branch: 'lane/1', base: 'main' }, exec)

    expect(result.kind).toBe('failed')
  })
})

function gitRevParse(cwd: string, ref: string): string {
  return execIn(cwd, ['rev-parse', ref]).trim()
}

function execIn(cwd: string, args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  return execFileSync('git', args, { cwd, env }).toString()
}
