import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  writeRunSettings,
  buildSettings,
  transcriptPathFor,
  resumableIn,
} from '../../src/runtime/claude-launch.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

let directory: string

beforeEach(() => {
  directory = makeTempDir('claude-launch-')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 })
})

const options = () => ({
  runId: '11111111-2222-3333-4444-555555555555',
  settingsDirectory: join(directory, 'settings'),
  hookScriptPath: '/opt/terminator/pretooluse-hook.mjs',
  controlUrl: 'http://127.0.0.1:5051/pretooluse',
  controlToken: 'abc123',
  nodePath: '/opt/Terminator.app/Contents/MacOS/Terminator',
})

// A conversation is filed under the directory it ran in. One begun elsewhere —
// an architect that ran on the repository root before ADR-061 — cannot be
// resumed from the order's checkout, and `--resume` on it would end the turn.
describe('resumableIn', () => {
  it('resumes a conversation filed under this directory', () => {
    const home = makeTempDir('resumable-')
    const file = transcriptPathFor('/wt/order', 'sid', home)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}\n')
    expect(resumableIn('/wt/order', 'sid', home)).toBe('sid')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts fresh when the conversation was filed under another directory', () => {
    const home = makeTempDir('resumable-')
    const file = transcriptPathFor('/repos/a', 'sid', home)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}\n')
    expect(resumableIn('/wt/order', 'sid', home)).toBeUndefined()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts fresh when there is no conversation to resume', () => {
    expect(resumableIn('/wt/order', undefined)).toBeUndefined()
  })
})

describe('transcriptPathFor', () => {
  describe('encoding', encodingTests)
  describe('resolving the directory', resolvingTheDirectoryTests)
})

const settings = () =>
  buildSettings({
    hookScriptPath: '/opt/hook.mjs',
    controlUrl: 'http://127.0.0.1:1/pretooluse',
    controlToken: 'tok',
    sessionId: 's1',
    nodePath: '/opt/node',
  }) as {
    hooks: Record<
      string,
      Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }>
    >
  }

function encodingTests() {
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
}

function resolvingTheDirectoryTests() {
  // The runtime encodes the directory the *process* is in, and macOS hands out
  // two names for the same one. A worktree under `/var/folders/…` is
  // `/private/var/folders/…` to the process that chdir'd into it, so this
  // predicted a path nobody was writing — and every reader of it opened
  // nothing. The ladder reported rungs that had just run and exited 0 as "not
  // measured", and the stall detector, which reads transcripts and nothing
  // else, saw an agent that had never said a word.
  it('encodes the directory as the process sees it, not as it was handed to us', () => {
    const real = makeTempDir('transcript-real-')
    const link = path.join(path.dirname(real), `link-${path.basename(real)}`)
    fs.symlinkSync(real, link)
    try {
      expect(transcriptPathFor(link, 'sid', '/home/me')).toBe(
        transcriptPathFor(fs.realpathSync(link), 'sid', '/home/me')
      )
    } finally {
      fs.unlinkSync(link)
      fs.rmSync(real, { recursive: true, force: true })
    }
  })

  it('uses the name it was given when there is nothing there to resolve', () => {
    // A worktree about to be cut. The unresolved name is the best answer
    // available, and it is right wherever the two agree.
    expect(transcriptPathFor('/a/not/here/yet', 'sid', '/home/me')).toBe(
      '/home/me/.claude/projects/-a-not-here-yet/sid.jsonl'
    )
  })
}

describe('buildSettings', () => {
  describe('the PreToolUse hook', thePretooluseHookTests)

  // Turn end and end come from the agent protocol now, not from hooks.
  it('registers no lifecycle hooks', () => {
    expect(Object.keys(settings().hooks)).toEqual(['PreToolUse'])
  })
})

function thePretooluseHookTests() {
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
}

describe('writeRunSettings', () => {
  it('writes the settings file the agent is pointed at, named after the run', () => {
    const file = writeRunSettings(options())
    expect(file).toBe(
      join(directory, 'settings', '11111111-2222-3333-4444-555555555555.settings.json')
    )
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty('hooks.PreToolUse')
  })

  it('gives each run its own file, so two agents cannot answer for each other', () => {
    expect(writeRunSettings(options())).not.toBe(writeRunSettings({ ...options(), runId: 'other' }))
  })

  it('runs the hook with this application, when no other node is named', () => {
    const { nodePath: _unused, ...rest } = options()
    expect(readFileSync(writeRunSettings(rest), 'utf8')).toContain(process.execPath)
  })

  // `resolveWorktreeBaseDir('')` is `join('', '.worktrees')` — relative — and a relative
  // settings path is resolved against the card's worktree, where it never exists.
  it('is refused when the directory is relative, rather than failing inside the agent', () => {
    expect(() =>
      writeRunSettings({ ...options(), settingsDirectory: '.worktrees/.foundry-runtime/settings' })
    ).toThrow(/must be absolute/)
  })
})

describe('transcriptPathFor — what it falls back to', () => {
  it('looks under the current user home, when none is named', () => {
    expect(transcriptPathFor('/a', 'sid')).toContain(homedir())
  })
})
