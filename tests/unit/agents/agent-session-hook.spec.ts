import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let userData: string
let home: string

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'home' ? home : userData) },
}))

async function load() {
  vi.resetModules()
  return import('../../../src/main/agents/agent-session-hook')
}

const PAYLOAD = {
  session_id: 'b610a882-41f3-4833-a6a3-dc3a33aea060',
  transcript_path: '/Users/me/.claude/projects/slug/b610a882.jsonl',
  cwd: '/Users/me/code/repo',
  hook_event_name: 'SessionStart',
  source: 'startup',
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hook-ud-'))
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hook-home-'))
})

// The script is run for real: what matters is what it writes and what it prints,
// and asserting on the source string would prove neither.
describe('the capture script, executed', () => {
  async function run(
    payload: unknown,
    env: Record<string, string> = { TERMINATOR_SESSION_ID: 'sess-1' }
  ): Promise<{ out: string; dir: string }> {
    const mod = await load()
    const scriptPath = await mod.installCaptureScript(userData)
    const dir = path.join(userData, 'agent-sessions')
    const out = execFileSync(process.execPath, [scriptPath, dir], {
      encoding: 'utf8',
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { ...process.env, ...env },
    })
    return { out, dir }
  }

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
    const scriptPath = await mod.installCaptureScript(userData)
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

describe('installing the hook in the operator’s Claude settings', () => {
  const settingsPath = (): string => path.join(home, '.claude', 'settings.json')
  const read = (): Record<string, never> => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))

  async function install(): Promise<void> {
    const mod = await load()
    const scriptPath = await mod.installCaptureScript(userData)
    await mod.installUserHook({
      execPath: '/Applications/Terminator.app/Contents/MacOS/Terminator',
      scriptPath,
    })
  }

  it('creates the file with one SessionStart entry when there is none', async () => {
    await install()
    const hooks = read().hooks as {
      SessionStart: Array<{ matcher: string; hooks: Array<{ command: string }> }>
    }
    expect(hooks.SessionStart).toHaveLength(1)
    expect(hooks.SessionStart[0].matcher).toBe('*')
    expect(hooks.SessionStart[0].hooks[0].command).toContain('agent-session-hook.cjs')
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
    const settings = read() as unknown as {
      model: string
      hooks: { SessionStart: unknown[]; Stop: unknown[] }
    }
    expect(settings.model).toBe('opus')
    expect(settings.hooks.Stop).toHaveLength(1)
    expect(settings.hooks.SessionStart).toHaveLength(2)
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain('theirs.sh')
  })

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

  it('does nothing rather than failing when its script has gone', async () => {
    const mod = await load()
    const scriptPath = await mod.installCaptureScript(userData)
    await mod.installUserHook({ execPath: process.execPath, scriptPath })
    const hooks = read().hooks as { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    const command = hooks.SessionStart[0].hooks[0].command
    fs.rmSync(scriptPath)
    // Exactly as a shell would run it from the settings file.
    expect(() => execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).not.toThrow()
  })
})
