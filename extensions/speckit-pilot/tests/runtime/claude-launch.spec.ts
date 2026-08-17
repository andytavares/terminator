import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import {
  buildLaunchSpec,
  buildSettings,
  shellQuote,
  transcriptPathFor,
} from '../../src/runtime/claude-launch.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'claude-launch-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 })
})

const options = () => ({
  sessionId: '11111111-2222-3333-4444-555555555555',
  cwd: '/tmp/wt/FLU-220-fluent',
  prompt: 'Implement T001',
  settingsDirectory: join(directory, 'settings'),
  hookScriptPath: '/opt/terminator/pretooluse-hook.mjs',
  controlUrl: 'http://127.0.0.1:5051/pretooluse',
  controlEventUrl: 'http://127.0.0.1:5051/event',
  controlToken: 'abc123',
  nodePath: '/opt/Terminator.app/Contents/MacOS/Terminator',
  claudePath: 'claude',
})

describe('shellQuote', () => {
  it('quotes a plain value', () => {
    expect(shellQuote('hello')).toBe(`'hello'`)
  })

  it('survives a value containing a quote, which a prompt very often does', () => {
    // The POSIX idiom: close the quote, escape one, reopen.
    expect(shellQuote(`don't`)).toBe(`'don'\\''t'`)
  })

  it('leaves a path with spaces in one argument', () => {
    expect(shellQuote('/Application Support/a b')).toBe(`'/Application Support/a b'`)
  })
})

describe('transcriptPathFor', () => {
  it('encodes the working copy the way the runtime does', () => {
    // Reproduced from a real run: separators and dots both become dashes.
    expect(transcriptPathFor('/private/tmp/scratchpad/hooktest', 'sid', '/home/me')).toBe(
      '/home/me/.claude/projects/-private-tmp-scratchpad-hooktest/sid.jsonl'
    )
  })

  it('turns a dot in a directory name into a dash too', () => {
    expect(transcriptPathFor('/a/my.repo', 'sid', '/home/me')).toBe(
      '/home/me/.claude/projects/-a-my-repo/sid.jsonl'
    )
  })

  it('names the file after the session, so it is known before the run exists', () => {
    expect(transcriptPathFor('/a', 'the-session', '/home/me')).toMatch(/the-session\.jsonl$/)
  })
})

describe('buildSettings', () => {
  const settings = () =>
    buildSettings({
      hookScriptPath: '/opt/hook.mjs',
      controlUrl: 'http://127.0.0.1:1/pretooluse',
      controlEventUrl: 'http://127.0.0.1:1/event',
      controlToken: 'tok',
      sessionId: 's1',
      nodePath: '/opt/node',
    }) as {
      hooks: Record<
        'PreToolUse' | 'Stop' | 'SessionEnd',
        Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }>
      >
    }

  it('registers a PreToolUse hook, which is the only event that can hold a tool call still', () => {
    expect(settings().hooks.PreToolUse).toHaveLength(1)
  })

  it('matches every tool rather than a list of the dangerous ones', () => {
    expect(settings().hooks.PreToolUse[0].matcher).toBe('*')
  })

  it('runs Electron as a node, so the hook does not relaunch the application', () => {
    expect(settings().hooks.PreToolUse[0].hooks[0].command).toContain('ELECTRON_RUN_AS_NODE=1')
  })

  it('passes the endpoint, the token and the session on the command line', () => {
    const { command } = settings().hooks.PreToolUse[0].hooks[0]
    expect(command).toContain(`'http://127.0.0.1:1/pretooluse'`)
    expect(command).toContain(`'tok'`)
    expect(command).toContain(`'s1'`)
  })

  it('waits hours rather than the default minute, because it is waiting for a person', () => {
    expect(settings().hooks.PreToolUse[0].hooks[0].timeout).toBe(43_200)
  })

  it('asks to be told when a turn ends, which is what tells finished from stuck', () => {
    expect(settings().hooks.Stop[0].hooks[0].command).toContain(`'stop'`)
  })

  it('asks to be told when the session ends', () => {
    expect(settings().hooks.SessionEnd[0].hooks[0].command).toContain(`'session_end'`)
  })

  it('sends lifecycle reports to the endpoint that answers immediately', () => {
    expect(settings().hooks.Stop[0].hooks[0].command).toContain(`'http://127.0.0.1:1/event'`)
  })

  it('gives a lifecycle hook seconds, because nothing is waiting on its answer', () => {
    expect(settings().hooks.Stop[0].hooks[0].timeout).toBe(10)
    expect(settings().hooks.SessionEnd[0].hooks[0].timeout).toBe(10)
  })
})

describe('buildLaunchSpec', () => {
  it('runs the session under the id the console chose', () => {
    const spec = buildLaunchSpec(options())
    expect(spec.command).toContain('--session-id 11111111-2222-3333-4444-555555555555')
    expect(spec.sessionId).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('knows where the transcript will be before the process exists', () => {
    expect(buildLaunchSpec(options()).transcriptPath).toMatch(
      /-tmp-wt-FLU-220-fluent\/11111111-2222-3333-4444-555555555555\.jsonl$/
    )
  })

  it('writes the settings it points the runtime at', () => {
    const spec = buildLaunchSpec(options())
    expect(spec.command).toContain(shellQuote(spec.settingsPath))
    expect(JSON.parse(readFileSync(spec.settingsPath, 'utf8'))).toHaveProperty('hooks.PreToolUse')
  })

  it('gives each session its own settings file, so two agents cannot answer for each other', () => {
    const first = buildLaunchSpec(options())
    const second = buildLaunchSpec({ ...options(), sessionId: 'other' })
    expect(first.settingsPath).not.toBe(second.settingsPath)
  })

  it('creates the settings directory rather than requiring one', () => {
    expect(() => buildLaunchSpec(options())).not.toThrow()
  })

  it('lets the runtime decide what the ladder abstains on, rather than prompting', () => {
    // The PreToolUse hook runs under every permission mode and its allow/deny
    // is honoured first, so the ladder's judgement is unchanged; what the mode
    // picks up is only the abstentions. Under `default` those were questions —
    // twenty-five of them in one phase — and under `auto` the runtime's own
    // classifier answers them.
    expect(buildLaunchSpec(options()).command).toContain('--permission-mode auto')
  })

  it('passes no --model when none was chosen, so the operator config wins', () => {
    expect(buildLaunchSpec(options()).command).not.toContain('--model')
  })

  it('passes the chosen model, which is what the setting never used to do', () => {
    expect(buildLaunchSpec({ ...options(), model: 'opus' }).command).toContain("--model 'opus'")
  })

  it('quotes the model, since it is untrusted text on a shell command line', () => {
    const spec = buildLaunchSpec({ ...options(), model: "o'; rm -rf /" })
    expect(spec.command).toContain(`--model 'o'\\''; rm -rf /'`)
  })

  it('passes the composed prompt as one argument however it is punctuated', () => {
    const spec = buildLaunchSpec({ ...options(), prompt: `don't break it` })
    expect(spec.command).toContain(`'don'\\''t break it'`)
  })

  it('runs in the provisioned working copy', () => {
    expect(buildLaunchSpec(options()).cwd).toBe('/tmp/wt/FLU-220-fluent')
  })

  it('starts with the claude binary, because the terminal is what runs it', () => {
    expect(buildLaunchSpec(options()).command.startsWith('claude ')).toBe(true)
  })
})

describe('buildLaunchSpec — what it falls back to', () => {
  it('runs the hook with this application, when no other node is named', () => {
    const { nodePath: _unused, ...rest } = options()
    const spec = buildLaunchSpec(rest)
    expect(readFileSync(spec.settingsPath, 'utf8')).toContain(shellQuote(process.execPath))
  })

  it('finds claude on PATH, when no path to it is named', () => {
    const { claudePath: _unused, ...rest } = options()
    expect(buildLaunchSpec(rest).command.startsWith('claude ')).toBe(true)
  })
})

describe('transcriptPathFor — what it falls back to', () => {
  it('looks under the current user home, when none is named', () => {
    expect(transcriptPathFor('/a', 'sid')).toContain(homedir())
  })
})

describe('the settings path handed to the runtime', () => {
  // The bug this pins: `resolveWorktreeBaseDir('')` is `join('', '.worktrees')`
  // — relative — so `--settings .worktrees/…` was resolved against the card's
  // worktree, where it never exists. Every supervised run died on "Settings
  // file not found" the moment it launched, with the card still reading
  // WORKING and its console empty.
  it('is refused when it is relative, rather than failing inside the terminal', () => {
    expect(() =>
      buildLaunchSpec({
        sessionId: 'session-1',
        cwd: '/repo/.worktrees/a',
        prompt: '/speckit-specify',
        settingsDirectory: '.worktrees/.speckit-pilot-runtime/settings',
        hookScriptPath: '/state/hook.js',
        controlUrl: 'http://127.0.0.1:1/pretooluse',
        controlEventUrl: 'http://127.0.0.1:1/event',
        controlToken: 'token',
      })
    ).toThrow(/must be absolute/)
  })
})

describe('continuing a conversation that already exists', () => {
  // `--session-id` names a session being created. Handing it one the runtime
  // has already seen makes it exit with "Session ID … is already in use" —
  // and the shell around it survives, so no PTY exit fires and the run sits
  // registered as working with a dead agent.
  const options = {
    sessionId: 'eefcf9a4-143f-4e73-8d8d-6b6ad94b9ab5',
    cwd: '/repo/.worktrees/a',
    prompt: 'carry on',
    hookScriptPath: '/state/hook.js',
    controlUrl: 'http://127.0.0.1:1/pretooluse',
    controlEventUrl: 'http://127.0.0.1:1/event',
    controlToken: 'token',
  }

  it('resumes rather than claiming the id again', () => {
    const spec = buildLaunchSpec({ ...options, settingsDirectory: directory, resume: true })
    expect(spec.command).toContain(`--resume ${options.sessionId}`)
    expect(spec.command).not.toContain('--session-id')
  })

  it('still claims a new id when it is starting one', () => {
    const spec = buildLaunchSpec({ ...options, settingsDirectory: directory })
    expect(spec.command).toContain(`--session-id ${options.sessionId}`)
    expect(spec.command).not.toContain('--resume')
  })
})
