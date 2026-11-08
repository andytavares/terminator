import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

let userData: string
let home: string

// Electron's home on macOS is the account's, whatever HOME says: a sealed run's HOME never reached
// it, and e2e and smoke runs rewrote the developer's own ~/.claude/settings.json.
const ACCOUNT_HOME = '/Users/account-home-never-written'
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'home' ? ACCOUNT_HOME : userData) },
}))

async function load() {
  vi.resetModules()
  return import('../../../src/agents/claude-hook')
}

const PAYLOAD = {
  session_id: 'b610a882-41f3-4833-a6a3-dc3a33aea060',
  transcript_path: '/Users/me/.claude/projects/slug/b610a882.jsonl',
  cwd: '/Users/me/code/repo',
  hook_event_name: 'SessionStart',
  source: 'startup',
}

beforeEach(() => {
  userData = makeTempDir('claude-hook-ud-')
  home = makeTempDir('agent-hook-home-')
  vi.stubEnv('HOME', home)
})

// The script is run for real: what matters is what it writes and what it prints,
// and asserting on the source string would prove neither.
async function run(
  payload: unknown,
  env: Record<string, string> = { TERMINATOR_SESSION_ID: 'sess-1' }
): Promise<{ out: string; dir: string }> {
  const mod = await load()
  const scriptPath = await mod.installHookScript(userData)
  const dir = path.join(userData, 'agent-sessions')
  const out = execFileSync(process.execPath, [scriptPath, dir], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, ...env },
  })
  return { out, dir }
}

describe('the hook script, a session, executed', () => {
  it('writes the conversation under the terminal it ran in, and says nothing', async () => {
    const { out, dir } = await run(PAYLOAD)
    expect(out).toBe('')
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'sess-1.json'), 'utf8'))
    expect(written).toMatchObject({
      terminal: 'sess-1',
      provider: 'claude',
      sessionId: PAYLOAD.session_id,
      transcriptPath: PAYLOAD.transcript_path,
      cwd: PAYLOAD.cwd,
      source: 'startup',
    })
    expect(Date.parse(written.at)).not.toBeNaN()
  })

  it('replaces the file when a second conversation runs in the same terminal', async () => {
    const { dir } = await run(PAYLOAD)
    await run({ ...PAYLOAD, session_id: 'second-id' })
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'sess-1.json'), 'utf8'))
    expect(written.sessionId).toBe('second-id')
    expect(fs.readdirSync(dir)).toEqual(['sess-1.json'])
  })
})

describe('the hook script, a session, executed — terminals it does not own', () => {
  it('keeps two terminals apart', async () => {
    await run(PAYLOAD)
    const { dir } = await run(
      { ...PAYLOAD, session_id: 'other' },
      { TERMINATOR_SESSION_ID: 'sess-2' }
    )
    expect(fs.readdirSync(dir).sort()).toEqual(['sess-1.json', 'sess-2.json'])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'sess-2.json'), 'utf8')).sessionId).toBe(
      'other'
    )
  })

  it('writes nothing for a conversation in a terminal this app does not own', async () => {
    const { out, dir } = await run(PAYLOAD, { TERMINATOR_SESSION_ID: '' })
    expect(out).toBe('')
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([])
  })
})

describe('the hook script, a session, executed — unusable input', () => {
  it.each([['not json at all'], [''], [JSON.stringify({ hook_event_name: 'SessionStart' })]])(
    'exits quietly on input it cannot use: %s',
    async (input) => {
      const { out, dir } = await run(input)
      expect(out).toBe('')
      expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([])
    }
  )

  it('exits quietly when it cannot write', async () => {
    const mod = await load()
    const scriptPath = await mod.installHookScript(userData)
    const blocked = path.join(userData, 'blocked')
    fs.writeFileSync(blocked, 'not a directory')
    const out = execFileSync(process.execPath, [scriptPath, blocked], {
      encoding: 'utf8',
      input: JSON.stringify(PAYLOAD),
      env: { ...process.env, TERMINATOR_SESSION_ID: 'sess-1' },
    })
    expect(out).toBe('')
  })
})

let sessionContextDir: string

async function runWithSessionContext(
  env: Record<string, string> = { TERMINATOR_SESSION_ID: 'sess-1' }
): Promise<{ out: string; dir: string }> {
  const mod = await load()
  const scriptPath = await mod.installHookScript(userData)
  const dir = path.join(userData, 'agent-sessions')
  const out = execFileSync(process.execPath, [scriptPath, dir, sessionContextDir], {
    encoding: 'utf8',
    input: JSON.stringify(PAYLOAD),
    env: { ...process.env, ...env },
  })
  return { out, dir }
}

function useSessionContextDir(): void {
  beforeEach(() => {
    sessionContextDir = makeTempDir('agent-hook-sctx-')
  })
}

describe('the hook script, a session, executed — printing the session’s own agent context', () => {
  useSessionContextDir()

  it('prints additionalContext when the terminal has a session context file', async () => {
    fs.writeFileSync(
      path.join(sessionContextDir, 'sess-1.json'),
      JSON.stringify({ markdown: '# Linked issue: TAV-42', key: 'TAV-42' }),
      'utf8'
    )
    const { out, dir } = await runWithSessionContext()
    const parsed = JSON.parse(out)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('# Linked issue: TAV-42')
    expect(parsed.hookSpecificOutput.sessionTitle).toBe('TAV-42')
    // The report is still written — printing context is additional, not instead.
    expect(fs.existsSync(path.join(dir, 'sess-1.json'))).toBe(true)
  })

  it('prints nothing when the terminal has no session context file', async () => {
    const { out, dir } = await runWithSessionContext()
    expect(out).toBe('')
    expect(fs.existsSync(path.join(dir, 'sess-1.json'))).toBe(true)
  })
})

describe('the hook script, a session, executed — empty or foreign session context', () => {
  useSessionContextDir()

  it('prints nothing when the session context has no markdown', async () => {
    fs.writeFileSync(
      path.join(sessionContextDir, 'sess-1.json'),
      JSON.stringify({ markdown: '', key: 'TAV-42' }),
      'utf8'
    )
    const { out } = await runWithSessionContext()
    expect(out).toBe('')
  })

  it('prints nothing for a terminal this app does not own', async () => {
    const { out } = await runWithSessionContext({ TERMINATOR_SESSION_ID: '' })
    expect(out).toBe('')
  })
})

const NOTIFICATION = {
  session_id: 'abc',
  transcript_path: '/t.jsonl',
  cwd: '/repo',
  hook_event_name: 'Notification',
  message: 'Claude needs your permission to use Bash',
  notification_type: 'permission_prompt',
}

// The script is run for real: what matters is the file it writes.
async function runAsk(
  payload: unknown,
  env: Record<string, string> = { TERMINATOR_SESSION_ID: 's1' }
) {
  const mod = await load()
  const scriptPath = await mod.installHookScript(userData)
  const dir = path.join(userData, 'agent-sessions')
  const out = execFileSync(process.execPath, [scriptPath, dir], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, ...env },
  })
  const asks = path.join(dir, 'asks')
  return { out, asks, files: fs.existsSync(asks) ? fs.readdirSync(asks) : [] }
}

function onlyReport(asks: string): Record<string, string | null> {
  const names = fs.readdirSync(asks)
  expect(names).toHaveLength(1)
  return JSON.parse(fs.readFileSync(path.join(asks, names[0]), 'utf8'))
}

describe('the hook script, an ask, executed', () => {
  it('writes a notification under the terminal it ran in, and says nothing', async () => {
    const { out, asks } = await runAsk(NOTIFICATION)
    expect(out).toBe('')
    const written = onlyReport(asks)
    expect(written).toMatchObject({
      terminal: 's1',
      event: 'notification',
      message: 'Claude needs your permission to use Bash',
      notificationType: 'permission_prompt',
    })
    expect(Date.parse(written.at ?? '')).not.toBeNaN()
  })

  it('writes a stop with no message and no type', async () => {
    const { asks } = await runAsk({ hook_event_name: 'Stop', session_id: 'abc' })
    expect(onlyReport(asks)).toMatchObject({
      event: 'stop',
      message: '',
      notificationType: null,
    })
  })
})

describe('the hook script, an ask, executed — events in a row', () => {
  it('keeps every event: a stop written before the notification is read does not replace it', async () => {
    await runAsk(NOTIFICATION)
    const { asks, files } = await runAsk({ hook_event_name: 'Stop', session_id: 'abc' })
    expect(files).toHaveLength(2)
    const events = files
      .sort()
      .map((name) => JSON.parse(fs.readFileSync(path.join(asks, name), 'utf8')).event)
    expect(events).toEqual(['notification', 'stop'])
  })
})

describe('the hook script, an ask, executed — file names', () => {
  // Two hooks of one turn can land in the same millisecond, and pids say nothing about order:
  // the name carries the time to the microsecond, fixed width, so names sort by time.
  it('names the event by its time to the microsecond, then the process', async () => {
    const { files } = await runAsk(NOTIFICATION)
    expect(files[0]).toMatch(/^\d{13}\.\d{3}-\d+\.json$/)
  })
})

describe('the hook script, an ask, executed — a prompt', () => {
  it('writes a UserPromptSubmit as a prompt', async () => {
    const { asks } = await runAsk({ hook_event_name: 'UserPromptSubmit', prompt: 'do it' })
    expect(onlyReport(asks)).toMatchObject({
      terminal: 's1',
      event: 'prompt',
      message: '',
    })
  })
})

describe('the hook script, an ask, executed — a failed turn', () => {
  it('writes a StopFailure as a stop: the turn ended on an API error', async () => {
    const { asks } = await runAsk({ hook_event_name: 'StopFailure', error: 'rate_limit' })
    expect(onlyReport(asks)).toMatchObject({
      terminal: 's1',
      event: 'stop',
    })
  })
})

describe('the hook script, an ask, executed — input it cannot use', () => {
  it.each([
    ['garbage', 'not json at all', { TERMINATOR_SESSION_ID: 's1' }],
    ['empty input', '', { TERMINATOR_SESSION_ID: 's1' }],
    ['another event', { hook_event_name: 'SessionStart' }, { TERMINATOR_SESSION_ID: 's1' }],
    ['a terminal this app does not own', NOTIFICATION, { TERMINATOR_SESSION_ID: '' }],
  ])('is silent and writes nothing for %s', async (_label, payload, env) => {
    const { out, files } = await runAsk(payload, env)
    expect(out).toBe('')
    expect(files).toEqual([])
  })

  it('is silent when it cannot write', async () => {
    const mod = await load()
    const scriptPath = await mod.installHookScript(userData)
    const blocked = path.join(userData, 'blocked')
    fs.writeFileSync(blocked, 'not a directory')
    const out = execFileSync(process.execPath, [scriptPath, blocked], {
      encoding: 'utf8',
      input: JSON.stringify(NOTIFICATION),
      env: { ...process.env, TERMINATOR_SESSION_ID: 's1' },
    })
    expect(out).toBe('')
  })
})

// A stand-in for Electron that records it was started.
async function installedCommand(): Promise<{ command: string; started: string }> {
  const started = path.join(userData, 'electron-started')
  const stub = path.join(userData, 'stub-electron.sh')
  fs.writeFileSync(stub, `#!/bin/sh\ntouch ${started}\n`, { mode: 0o755 })
  const mod = await load()
  const scriptPath = await mod.installHookScript(userData)
  await mod.installUserHooks({ execPath: stub, scriptPath })
  const settings = path.join(home, '.claude', 'settings.json')
  const hooks = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks
  return { command: hooks.Stop[0].hooks[0].command, started }
}

describe('the installed hook command, run through a shell', () => {
  const shell = (command: string, env: Record<string, string>) =>
    spawnSync('/bin/sh', ['-c', command], { env: { PATH: process.env.PATH ?? '', ...env } })

  it('starts nothing outside Terminator, and still exits 0', async () => {
    const { command, started } = await installedCommand()
    const result = shell(command, {})
    expect(result.status).toBe(0)
    expect(fs.existsSync(started)).toBe(false)
  })

  it('starts the script inside a Terminator terminal', async () => {
    const { command, started } = await installedCommand()
    const result = shell(command, { TERMINATOR_SESSION_ID: 's1' })
    expect(result.status).toBe(0)
    expect(fs.existsSync(started)).toBe(true)
  })
})

const settingsPath = (): string => path.join(home, '.claude', 'settings.json')
/** The settings file as JSON, read as the shape the case expects. */
const read = <T = { hooks: unknown }>(): T => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))

describe('installing the hook — a missing script', () => {
  it('does nothing rather than failing when its script has gone', async () => {
    const mod = await load()
    const scriptPath = await mod.installHookScript(userData)
    await mod.installUserHooks({ execPath: process.execPath, scriptPath })
    const hooks = read().hooks as { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    const command = hooks.SessionStart[0].hooks[0].command
    fs.rmSync(scriptPath)
    // Exactly as a shell would run it from the settings file.
    // execFileSync throws on a non-zero exit.
    expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toBe('')
  })
})
