import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { readDiffSummary, readChangedFiles } from '../../../src/runtime/diff-metrics.js'
import { makeTempDir } from '../../../../../tests/support/temp-dir'

function commitFile(repo: string, name: string, message: string): void {
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  writeFileSync(join(repo, name), `${name}\n`)
  sh('add', '.')
  sh('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message)
}

describe('a lane branch behind its base', laneBehindBaseTests)

const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()

/** Real git, as the host's shell answers it. */
const run = async (_cmd: string, args: string[], cwd: string) => {
  try {
    return { ok: true, stdout: sh(cwd, ...args), stderr: '' }
  } catch (error) {
    return { ok: false, stdout: '', stderr: String(error) }
  }
}

/** A lane cut from main, main one commit further on, and the lane's edits uncommitted. */
function laneBehindMain(): string {
  const repo = makeTempDir('diff-metrics-fork-')
  sh(repo, 'init', '-q', '-b', 'main')
  commitFile(repo, 'a.txt', 'base')
  sh(repo, 'branch', 'lane')
  commitFile(repo, 'newer-on-main.txt', 'main moved')
  sh(repo, 'checkout', '-q', 'lane')
  for (const name of ['a.txt', 'fresh.txt']) writeFileSync(join(repo, name), 'changed\n')
  return repo
}

function laneBehindBaseTests() {
  let repo: string
  beforeEach(() => {
    repo = laneBehindMain()
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5 }))

  it("lists only the lane's own files, not the base's newer ones", async () => {
    const files = await readChangedFiles(repo, 'main', run)
    expect(files.sort()).toEqual(['a.txt', 'fresh.txt'])
  })

  it("counts only the lane's own files in the summary", async () => {
    const summary = await readDiffSummary(repo, 'main', { run })
    expect(summary.files).toBe(2)
  })

  it('measures from origin/<base> when the lane was cut from it and the local base is behind', async () => {
    sh(repo, 'checkout', '-q', 'main')
    sh(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    sh(repo, 'checkout', '-q', '-B', 'cut-from-origin', 'origin/main')
    sh(repo, 'branch', '-f', 'main', 'HEAD~1')
    writeFileSync(join(repo, 'only-mine.txt'), 'new\n')
    expect((await readChangedFiles(repo, 'main', run)).sort()).toEqual([
      'a.txt',
      'fresh.txt',
      'only-mine.txt',
    ])
  })
}
