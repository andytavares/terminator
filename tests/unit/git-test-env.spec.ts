import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `git fetch` starts `git maintenance run --auto --detach`, which keeps writing
// into the repository after the command returns. A spec's afterEach then
// deletes the directory under it and fails with ENOTEMPTY — only on a busy
// machine, which is how it read as a flake. tests/setup.ts turns it off, for
// specs that scrub GIT_* from git's environment too.
describe('git run by the test suite', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('never starts background maintenance on fetch', () => {
    dir = mkdtempSync(join(tmpdir(), 'git-test-env-'))
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    git(dir, 'init', '-q', '-b', 'main', 'origin')
    git(
      join(dir, 'origin'),
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'b'
    )
    git(dir, 'clone', '-q', 'origin', 'clone')
    const scrubbed = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_TRACE2_EVENT')
    ) as NodeJS.ProcessEnv
    const commit = execFileSync(
      'sh',
      ['-c', 'GIT_TRACE=1 git -c user.name=t -c user.email=t@t commit -q --allow-empty -m c 2>&1'],
      { cwd: join(dir, 'clone'), env: scrubbed, encoding: 'utf-8' }
    )
    expect(commit).not.toMatch(/maintenance run --auto/)
    const trace = execFileSync('sh', ['-c', 'GIT_TRACE=1 git fetch -q origin 2>&1'], {
      cwd: join(dir, 'clone'),
      encoding: 'utf-8',
    })
    expect(trace).toContain('fetch')
    expect(trace).not.toMatch(/maintenance run --auto/)
  })

  it('leaves nothing writing into .git after a commit returns', async () => {
    dir = mkdtempSync(join(tmpdir(), 'git-test-env-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'c'],
      { cwd: dir }
    )
    const files = (): string[] =>
      readdirSync(join(dir, '.git'), { recursive: true }).map(String).sort()
    const before = files()
    await new Promise((settle) => setTimeout(settle, 1500))
    expect(files()).toEqual(before)
  })
})
