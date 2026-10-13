import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execShell } from '../../../src/main/shell/shell-executor'
import { startAdoptingLoginShellPath } from '../../../src/main/shell/login-shell-path'
import { makeTempDir } from '../../support/temp-dir'

// On macOS the window now opens while the login-shell PATH probe is still
// running. A command run in that window must still find tools that only the
// login shell's PATH has (Homebrew's gh, for one).

const originalPath = process.env.PATH
const originalShell = process.env.SHELL
let scratch: string

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

afterEach(() => {
  process.env.PATH = originalPath
  process.env.SHELL = originalShell
  rmSync(scratch, { recursive: true, force: true })
})

describe('execShell while the login-shell PATH is still being read', () => {
  it('waits for it, so a tool only on that PATH is found', async () => {
    scratch = makeTempDir('login-path-')
    const loginBin = join(scratch, 'bin')
    mkdirSync(loginBin)
    executable(join(loginBin, 'gh'), 'echo from-login-path')
    // A slow login shell that reports a PATH containing loginBin.
    const shell = join(scratch, 'slow-shell')
    executable(shell, `sleep 0.3\nprintf '__TERMINATOR_PATH__%s__TERMINATOR_PATH__' "${loginBin}"`)
    process.env.SHELL = shell

    void startAdoptingLoginShellPath(process.env)
    const result = await execShell({ command: 'gh', args: [], cwd: scratch })

    expect(result.stdout.trim()).toBe('from-login-path')
    expect(result.exitCode).toBe(0)
  })
})
