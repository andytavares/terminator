import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

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
  return import('../../../src/main/agents/claude-hook')
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

const settingsPath = (): string => path.join(home, '.claude', 'settings.json')
/** The settings file as JSON, read as the shape the case expects. */
const read = <T = { hooks: unknown }>(): T => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))

async function install(): Promise<void> {
  const mod = await load()
  const scriptPath = await mod.installHookScript(userData)
  await mod.installUserHooks({
    execPath: '/Applications/Terminator.app/Contents/MacOS/Terminator',
    scriptPath,
  })
}

describe('installing the hook in the operator’s Claude settings', () => {
  it('creates the file with one SessionStart entry when there is none', async () => {
    await install()
    const hooks = read().hooks as {
      SessionStart: Array<{ matcher: string; hooks: Array<{ command: string }> }>
    }
    expect(hooks.SessionStart).toHaveLength(1)
    expect(hooks.SessionStart[0].matcher).toBe('*')
    expect(hooks.SessionStart[0].hooks[0].command).toContain('claude-hook.cjs')
  })

  it('merges: every other entry and every other key survives', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        model: 'opus',
        hooks: {
          SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'theirs.sh' }] }],
          Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'stop.sh' }] }],
        },
      })
    )
    await install()
    const settings = read<{ model: string; hooks: { SessionStart: unknown[]; Stop: unknown[] } }>()
    expect(settings.model).toBe('opus')
    expect(JSON.stringify(settings.hooks.Stop)).toContain('stop.sh')
    expect(settings.hooks.SessionStart).toHaveLength(2)
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain('theirs.sh')
  })
})

describe('installing the hook — repeats and unreadable settings', () => {
  it('is idempotent: installing twice leaves one entry of ours', async () => {
    await install()
    await install()
    const hooks = read().hooks as { SessionStart: unknown[] }
    expect(hooks.SessionStart).toHaveLength(1)
  })

  it('never overwrites settings it cannot parse', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(settingsPath(), '{ this is not json')
    await expect(install()).rejects.toThrow()
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ this is not json')
  })
})

describe('installing the hook — entries from earlier installs', () => {
  it('replaces an entry left by another install of this application', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: '/some/old/profile/agent-session-hook.cjs x' }],
            },
          ],
        },
      })
    )
    await install()
    const hooks = read().hooks as { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    expect(hooks.SessionStart).toHaveLength(1)
    expect(hooks.SessionStart[0].hooks[0].command).not.toContain('/some/old/profile/')
  })
})

describe('installing the hook — collapsing earlier installs', () => {
  // Found in a real settings file: eight entries, one per development profile,
  // because only the first was ever replaced.
  it('collapses every entry left by earlier installs into one, keeping the rest', async () => {
    const stale = (n: number) => ({
      matcher: '*',
      hooks: [{ type: 'command', command: `/profile-${n}/agent-session-hook.cjs x` }],
    })
    const theirs = { hooks: [{ type: 'command', command: '/Users/me/.claude/hooks/weekly.sh' }] }
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ hooks: { SessionStart: [theirs, stale(1), stale(2), stale(3)] } })
    )
    await install()
    const hooks = read().hooks as { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    expect(hooks.SessionStart).toHaveLength(2)
    expect(hooks.SessionStart[0]).toEqual(theirs)
    expect(hooks.SessionStart[1].hooks[0].command).not.toContain('/profile-')
  })
})

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

describe('the settings file the hooks go in', () => {
  it("is under HOME, so a sealed run's hooks land in its own home", async () => {
    const { userSettingsPath } = await load()
    expect(userSettingsPath()).toBe(path.join(home, '.claude', 'settings.json'))
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

describe('installing the hooks', () => {
  it('adds a Notification, a UserPromptSubmit and a Stop entry and keeps the operator’s own', async () => {
    const settings = path.join(home, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(settings), { recursive: true })
    fs.writeFileSync(
      settings,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } })
    )
    const mod = await load()
    const scriptPath = await mod.installHookScript(userData)
    await mod.installUserHooks({ execPath: process.execPath, scriptPath })
    await mod.installUserHooks({ execPath: process.execPath, scriptPath })
    const hooks = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks
    expect(hooks.Notification).toHaveLength(1)
    expect(hooks.UserPromptSubmit).toHaveLength(1)
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain('claude-hook.cjs')
    expect(hooks.StopFailure).toHaveLength(1)
    expect(hooks.Stop).toHaveLength(2)
    expect(JSON.stringify(hooks.Stop)).toContain('mine.sh')
    expect(hooks.Notification[0].hooks[0].command).toContain('claude-hook.cjs')
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

const entry = (command: string) => ({ matcher: '*', hooks: [{ type: 'command', command }] })
const oldEntry = (name: string) => entry(`ELECTRON_RUN_AS_NODE=1 /old/profile/${name} x`)
const THEIRS = entry('mine.sh')

function seedSettingsFromThreeOldScripts(): void {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  const session = oldEntry('agent-session-hook.cjs')
  const ask = oldEntry('agent-ask-hook.cjs')
  const hooks = {
    SessionStart: [session, THEIRS, session],
    Notification: [ask, ask],
    UserPromptSubmit: [ask],
    Stop: [THEIRS, ask],
    StopFailure: [ask],
  }
  fs.writeFileSync(settingsPath(), JSON.stringify({ hooks }))
}

type Entries = Array<{ hooks: Array<{ command: string }> }>

describe('installing the hooks — the three scripts of earlier versions', () => {
  it('ends with exactly one entry of ours per event, keeping the operator’s own', async () => {
    seedSettingsFromThreeOldScripts()
    await install()
    await install()
    const hooks = read<{ hooks: Record<string, Entries> }>().hooks
    for (const event of [
      'SessionStart',
      'Notification',
      'UserPromptSubmit',
      'Stop',
      'StopFailure',
    ]) {
      const ours = hooks[event].filter((e) => e.hooks[0].command.includes('claude-hook.cjs'))
      expect(ours).toHaveLength(1)
      expect(JSON.stringify(hooks[event])).not.toContain('/old/profile/')
    }
    expect(hooks.Notification).toHaveLength(1)
    expect(hooks.SessionStart).toEqual([THEIRS, expect.anything()])
    expect(hooks.Stop).toEqual([THEIRS, expect.anything()])
  })
})

describe('installing the hook script', () => {
  it('removes the scripts of earlier versions from the integrations folder', async () => {
    for (const name of ['agent-ask-hook.cjs', 'agent-session-hook.cjs', 'session-start-hook.cjs'])
      fs.writeFileSync(path.join(userData, name), '')
    const mod = await load()
    await mod.installHookScript(userData)
    expect(fs.readdirSync(userData)).toEqual(['claude-hook.cjs'])
  })
})
