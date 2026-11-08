import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { spawn as ptySpawn } from 'node-pty'
import { createSupervisedRunner } from '../../../src/runtime/supervised-runner.js'
import { makeTempDir } from '../../../../../packages/test-support/src/temp-dir'
import { partialFake } from '../../../../../packages/test-support/src/fakes'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { eventually } from '../../../../../packages/test-support/src/eventually'
import { scriptOf } from '../../helpers/command-script.js'

// The runner's command scripts, run in real shells and a real node-pty.

let dir: string
let ran: Array<{ file: string; args: string[] }>

beforeEach(() => {
  dir = makeTempDir('supervised-runner-')
  ran = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

// A command step's output used to vanish the moment the tab scrolled past it.
// logPath tees stdout+stderr to a file while keeping the script's own exit
// status as the verdict — the command's status, never tee's.
const LOG_SHELLS = ['/bin/sh', ...(existsSync('/bin/zsh') ? ['/bin/zsh'] : [])]

let logDir: string

/** The core's runInTerminal as these tests need it: it records the call and ends at once. */
function recordingApi(): ExtensionAPI {
  const project = { id: 'project-1', workspaceId: 'ws-1', name: 'p' }
  return partialFake<ExtensionAPI>({
    workspace: partialFake<ExtensionAPI['workspace']>({ addProject: async () => project }),
    pty: partialFake<ExtensionAPI['pty']>({
      closeTerminalTab: () => {},
      runInTerminal: (input) => {
        ran.push({ ...input })
        return Promise.resolve({ sessionId: 'terminal-1', exitCode: 0 })
      },
    }),
  })
}

/** The script the runner hands the terminal for `commandLine`, teeing to `logPath` if given. */
async function scriptFor(
  commandLine: string,
  logPath?: string,
  env?: Record<string, string>
): Promise<string> {
  await createSupervisedRunner({
    api: recordingApi(),
    stateDir: join(dir, 'state'),
    now: () => 1_000,
  }).runCommand({
    worktreePath: '/wt/feat-thing',
    workspaceId: 'ws-1',
    branch: 'feat/thing',
    title: 'Check',
    command: commandLine,
    logPath,
    env,
  })
  return scriptOf(ran[ran.length - 1])
}

describe('running a command with a log file', () => {
  beforeEach(() => {
    logDir = makeTempDir('supervised-runner-log-')
  })

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true, maxRetries: 5 })
  })

  for (const shell of LOG_SHELLS) loggedCommandTests(shell)
  for (const shell of LOG_SHELLS) exportedEnvironmentTests(shell)
})

function loggedCommandTests(shell: string) {
  it(`(${shell}) exits with the command's status, not tee's, and writes the log`, async () => {
    const logPath = join(logDir, 'false.log')
    const result = spawnSync(shell, [await scriptFor('false', logPath)])
    expect(result.status).toBe(1)
    expect(existsSync(logPath)).toBe(true)
  })

  it(`(${shell}) captures the command's exit code and its combined output in the log`, async () => {
    const logPath = join(logDir, 'echo.log')
    const result = spawnSync(shell, [await scriptFor('echo hello; exit 3', logPath)])
    expect(result.status).toBe(3)
    expect(readFileSync(logPath, 'utf8')).toContain('hello')
  })
}

// A line like `exec VAR=1 cmd` once broke every agent (exit 127), so the variables are
// real `export` lines, and this runs them in a real shell with a value that needs quoting.
function exportedEnvironmentTests(shell: string) {
  const awkward = `my folder/it's "quoted" $HOME`

  it(`(${shell}) gives the command the variable exactly as set, with and without a log`, async () => {
    const out = join(logDir, 'seen.txt')
    const printing = `printf '%s' "$FOUNDRY_PICTURES" > '${out}'`
    for (const logPath of [undefined, join(logDir, 'env.log')]) {
      const script = await scriptFor(printing, logPath, { FOUNDRY_PICTURES: awkward })
      expect(spawnSync(shell, [script]).status).toBe(0)
      expect(readFileSync(out, 'utf8')).toBe(awkward)
      rmSync(out)
    }
  })

  it(`(${shell}) exports each variable on its own line before the command runs`, async () => {
    const script = readFileSync(await scriptFor('true', undefined, { ONE: '1', TWO: '2' }), 'utf8')
    expect(script).toMatch(/^export ONE='1'\nexport TWO='2'$/m)
    expect(script.indexOf("export TWO='2'")).toBeLessThan(script.lastIndexOf('true'))
  })
}

// The app adopts only PATH from the login shell, so a bare `$SHELL script` lost what startup
// files export (extensions/foundry/CLAUDE.md, "Verification commands"). A real PTY and a
// temporary HOME whose startup file is the only place a variable is set; the check must see it.
interface StartupShell {
  shell: string
  files: Record<string, string>
}

/** Each shell there is, and the startup files where it reads the one variable a check needs. */
const EVERY_STARTUP_SHELL: StartupShell[] = [
  // An interactive login bash reads ~/.bash_profile, which is where the
  // usual setup sources ~/.bashrc from.
  {
    shell: '/bin/bash',
    files: {
      '.bash_profile': '[ -f ~/.bashrc ] && . ~/.bashrc\n',
      '.bashrc': 'export FOUNDRY_RC_ONLY=from-rc\n',
    },
  },
  {
    shell: '/bin/zsh',
    files: {
      // Debian and Ubuntu's /etc/zsh/zshrc runs compinit, which stops to ask
      // about group-writable system directories on CI's runner; that file's
      // own documented opt-out is this line in ~/.zshenv.
      '.zshenv': 'skip_global_compinit=1\n',
      '.zshrc': 'export FOUNDRY_RC_ONLY=from-rc\n',
    },
  },
]

const STARTUP_SHELLS = EVERY_STARTUP_SHELL.filter(({ shell }) => existsSync(shell))

let home: string
const savedEnv = { HOME: process.env.HOME, SHELL: process.env.SHELL }
/** What the tab printed, so a check that never ends says what the shell is waiting on. */
let printed = ''

/** Runs `input` in a real node-pty, ending it the way the core does when its tab closes. */
function runInRealPty(input: { file: string; args: string[]; cwd: string }) {
  return new Promise((resolve) => {
    const proc = ptySpawn(input.file, input.args, {
      cwd: input.cwd,
      env: process.env as Record<string, string>,
    })
    proc.onData((data) => {
      printed += data
      // Closing the tab: the core sends the process SIGHUP.
      if (data.includes('hang-up-now')) proc.kill('SIGHUP')
    })
    // As PtyManager reports it: null when a signal ended the process.
    proc.onExit(({ exitCode, signal }) =>
      resolve({ sessionId: 'terminal-1', exitCode: signal ? null : exitCode })
    )
  })
}

/** The core's runInTerminal, over a real node-pty and nothing else. */
function realPtyApi(): ExtensionAPI {
  const project = { id: 'project-1', workspaceId: 'ws-1', name: 'p' }
  return partialFake<ExtensionAPI>({
    workspace: partialFake<ExtensionAPI['workspace']>({ addProject: async () => project }),
    pty: partialFake<ExtensionAPI['pty']>({
      write: () => {},
      closeTerminalTab: () => {},
      runInTerminal: runInRealPty as ExtensionAPI['pty']['runInTerminal'],
    }),
  })
}

function runCheck(commandLine: string, logPath?: string): Promise<number | null> {
  return createSupervisedRunner({
    api: realPtyApi(),
    stateDir: join(dir, 'state'),
    now: () => 1_000,
  }).runCommand({
    worktreePath: dir,
    workspaceId: 'ws-1',
    branch: 'feat/thing',
    title: 'Check',
    command: commandLine,
    logPath,
  })
}

async function checkOrTimeOut(commandLine: string, logPath?: string): Promise<number | null> {
  const result: { ended: boolean; exitCode: number | null } = { ended: false, exitCode: null }
  const check = runCheck(commandLine, logPath).then((exitCode) =>
    Object.assign(result, { ended: true, exitCode })
  )
  await eventually(() => {
    if (!result.ended) throw new Error(`the check never ended; it printed:\n${printed}`)
  })
  await check
  return result.exitCode
}

/** Makes `startup.shell` the user's shell, in a HOME holding only its startup files. */
function withStartupShell(startup: StartupShell): void {
  for (const [name, body] of Object.entries(startup.files)) writeFileSync(join(home, name), body)
  process.env.HOME = home
  process.env.SHELL = startup.shell
}

describe('a check sees what the user’s shell startup files export', () => {
  beforeEach(() => {
    printed = ''
    home = makeTempDir('supervised-runner-home-')
    delete process.env.FOUNDRY_RC_ONLY
  })

  afterEach(() => {
    process.env.HOME = savedEnv.HOME
    process.env.SHELL = savedEnv.SHELL
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })

  for (const startup of STARTUP_SHELLS) startupFileTests(startup)
})

function startupFileTests(startup: StartupShell) {
  const { shell } = startup

  it(`(${shell}) passes a check that needs a variable only a startup file exports`, async () => {
    withStartupShell(startup)
    await expect(checkOrTimeOut('test "$FOUNDRY_RC_ONLY" = from-rc')).resolves.toBe(0)
  })

  it(`(${shell}) still resolves the command's own exit code, not the shell's`, async () => {
    withStartupShell(startup)
    await expect(checkOrTimeOut('echo "$FOUNDRY_RC_ONLY"; exit 3')).resolves.toBe(3)
  })

  // bash ends by the signal (null, "not measured"); zsh catches SIGHUP and
  // exits 1. Either way a check nobody let finish is never a pass.
  it(`(${shell}) never passes a check whose tab was closed while it ran`, async () => {
    withStartupShell(startup)
    await expect(checkOrTimeOut('echo hang-up-"now"; read -r line')).resolves.not.toBe(0)
  })

  it(`(${shell}) keeps both through the log file`, async () => {
    withStartupShell(startup)
    const logPath = join(home, 'logs', 'check.log')
    await expect(checkOrTimeOut('echo "$FOUNDRY_RC_ONLY"; exit 3', logPath)).resolves.toBe(3)
    expect(readFileSync(logPath, 'utf8')).toContain('from-rc')
  })
}
