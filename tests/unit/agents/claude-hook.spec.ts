import { describe, it, expect, beforeEach, vi } from 'vitest'

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

beforeEach(() => {
  userData = makeTempDir('claude-hook-ud-')
  home = makeTempDir('agent-hook-home-')
  vi.stubEnv('HOME', home)
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

describe('the settings file the hooks go in', () => {
  it("is under HOME, so a sealed run's hooks land in its own home", async () => {
    const { userSettingsPath } = await load()
    expect(userSettingsPath()).toBe(path.join(home, '.claude', 'settings.json'))
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
  it('removes the scripts of earlier versions, but keeps the one project settings still run', async () => {
    for (const name of ['agent-ask-hook.cjs', 'agent-session-hook.cjs', 'session-start-hook.cjs'])
      fs.writeFileSync(path.join(userData, name), '')
    const mod = await load()
    await mod.installHookScript(userData)
    expect(fs.readdirSync(userData).sort()).toEqual(['claude-hook.cjs', 'session-start-hook.cjs'])
  })
})
