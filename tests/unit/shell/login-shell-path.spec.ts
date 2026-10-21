import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import {
  adoptLoginShellPath,
  LOGIN_SHELL_TIMEOUT_MS,
} from '../../../src/main/shell/login-shell-path'
import { stopRunningCommands } from '../../../src/main/shell/command-runner'
import { makeTempDir } from '../../support/temp-dir'
import { expectProcessGone, recordedPid } from '../../support/processes'

let dir: string

function fakeShell(body: string): string {
  const file = join(dir, 'fake-shell')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return file
}

beforeEach(() => {
  dir = makeTempDir('login-shell-path-')
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

describe('adoptLoginShellPath with a slow shell', () => {
  it('adopts the PATH of a shell that takes longer to start than the app would wait for', async () => {
    const shell = fakeShell(
      `sleep 1; printf '__TERMINATOR_PATH__/opt/homebrew/bin:/usr/bin__TERMINATOR_PATH__'`
    )
    const env: NodeJS.ProcessEnv = { SHELL: shell, PATH: '/usr/bin:/bin' }

    await adoptLoginShellPath(env, 5000)
    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')

    const late: NodeJS.ProcessEnv = { SHELL: shell, PATH: '/usr/bin:/bin' }
    await adoptLoginShellPath(late, 300)
    expect(late.PATH, 'a shell past the wait leaves PATH alone').toBe('/usr/bin:/bin')
  })

  it('waits long enough by default for a shell whose rc files take several seconds', () => {
    expect(LOGIN_SHELL_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000)
  })
})

describe('adoptLoginShellPath while the app quits', () => {
  // An interactive login shell runs the person's rc files, which can start
  // processes of their own; quitting during the probe must end them too.
  it('is stopped with whatever the login shell had started', async () => {
    const pidFile = join(dir, 'grandchild.pid')
    const shell = fakeShell(`sleep 30 &\necho $! > "${pidFile}"\nwait`)
    const env: NodeJS.ProcessEnv = { SHELL: shell, PATH: '/usr/bin:/bin' }

    const adopting = adoptLoginShellPath(env)
    const grandchild = await recordedPid(pidFile)
    stopRunningCommands()
    await adopting

    expect(env.PATH).toBe('/usr/bin:/bin')
    await expectProcessGone(grandchild)
  })
})
