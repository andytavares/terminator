import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { adoptLoginShellPath } from '../../../src/main/shell/login-shell-path'

let dir: string

function fakeShell(body: string): string {
  const file = join(dir, 'fake-shell')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return file
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'login-shell-path-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('adoptLoginShellPath', () => {
  it("puts the login shell's PATH ahead of the app's and keeps the app's missing entries", async () => {
    // An interactive rc file can print anything; only the marked value counts.
    const shell = fakeShell(
      `echo "welcome banner"; printf '__TERMINATOR_PATH__/opt/homebrew/bin:/usr/bin__TERMINATOR_PATH__'`
    )
    const env: NodeJS.ProcessEnv = { SHELL: shell, PATH: '/usr/bin:/bin' }

    await adoptLoginShellPath(env)

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })

  it('leaves PATH alone when the login shell fails', async () => {
    const env: NodeJS.ProcessEnv = { SHELL: fakeShell('exit 1'), PATH: '/usr/bin:/bin' }

    await adoptLoginShellPath(env)

    expect(env.PATH).toBe('/usr/bin:/bin')
  })

  it('leaves PATH alone when the output carries no marked value', async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: fakeShell('echo /somewhere/bin'),
      PATH: '/usr/bin:/bin',
    }

    await adoptLoginShellPath(env)

    expect(env.PATH).toBe('/usr/bin:/bin')
  })

  it('leaves PATH alone when SHELL does not exist', async () => {
    const env: NodeJS.ProcessEnv = { SHELL: join(dir, 'missing'), PATH: '/usr/bin:/bin' }

    await adoptLoginShellPath(env)

    expect(env.PATH).toBe('/usr/bin:/bin')
  })
})
