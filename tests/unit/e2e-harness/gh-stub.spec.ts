import { spawn } from 'node:child_process'
import { chmodSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from '../../support/temp-dir'

// With no stub GitHub running, fixtures/bin/gh hands a call to the next gh on PATH, which
// may reach its own folder as `fixtures/zdotdir/../bin`: taken for another gh, it ran itself
// until fork failed (macOS run 38380127678, 594 `node` processes in one chain).

const STUB_DIR = resolve(__dirname, '../../e2e/fixtures/bin')
const STUB_TIMEOUT_MS = 3000

function fakeRealGh(): string {
  const dir = makeTempDir('real-gh-')
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "real gh $*"\n')
  chmodSync(join(dir, 'gh'), 0o755)
  return dir
}

/** Runs the stub with `path` as PATH, in a process group of its own so a stub
 * that keeps starting itself is killed whole when the deadline passes. */
function runStub(path: string[]): Promise<string> {
  const env = {
    PATH: [...path, dirname(process.execPath)].join(delimiter),
    XDG_CONFIG_HOME: makeTempDir('gh-config-'),
  }
  const stub = spawn(process.execPath, [join(STUB_DIR, 'gh'), '--version'], { env, detached: true })
  let stdout = ''
  stub.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  return new Promise((done, fail) => {
    const deadline = setTimeout(() => {
      process.kill(-(stub.pid ?? 0), 'SIGKILL')
      fail(new Error(`the gh stub was still running after ${STUB_TIMEOUT_MS} ms`))
    }, STUB_TIMEOUT_MS)
    stub.once('exit', () => {
      clearTimeout(deadline)
      done(stdout)
    })
  })
}

describe('the gh stub without a stub GitHub', () => {
  it('hands the call to the next gh on PATH', async () => {
    expect(await runStub([STUB_DIR, fakeRealGh()])).toBe('real gh --version\n')
  })

  it('skips its own folder when PATH names it through ..', async () => {
    const throughZdotdir = join(STUB_DIR, '..', 'zdotdir') + '/../bin'
    expect(await runStub([throughZdotdir, fakeRealGh()])).toBe('real gh --version\n')
  })

  it('skips its own folder when PATH names it through a symlink', async () => {
    const link = join(makeTempDir('gh-link-'), 'bin')
    symlinkSync(STUB_DIR, link)
    expect(await runStub([link, fakeRealGh()])).toBe('real gh --version\n')
  })
})
