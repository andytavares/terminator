import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

async function load() {
  vi.resetModules()
  return import('../../../src/integrations/session-hook')
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
let projectDir: string

beforeEach(() => {
  userData = makeTempDir('session-hook-ud-')
  projectDir = makeTempDir('session-hook-proj-')
})

function settingsPath(): string {
  return path.join(projectDir, '.claude', 'settings.local.json')
}

function readClaudeSettingsFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
}

describe('hookCommand', () => {
  it('runs Electron as node, so no node on PATH is required', async () => {
    const mod = await load()
    const command = mod.hookCommand({
      execPath: '/Applications/Terminator.app/Contents/MacOS/Terminator',
      hookScriptPath: '/tmp/hook.cjs',
      projectId: PROJECT_ID,
    })
    expect(command.startsWith('ELECTRON_RUN_AS_NODE=1 ')).toBe(true)
    expect(command).toContain('/tmp/hook.cjs')
    expect(command).toContain(PROJECT_ID)
    expect(command).toContain(path.join(userData, 'agent-sessions'))
  })

  it('passes the session-context directory, so the project link can defer to the session’s own', async () => {
    const mod = await load()
    const command = mod.hookCommand({
      execPath: '/bin/electron',
      hookScriptPath: '/tmp/hook.cjs',
      projectId: PROJECT_ID,
    })
    expect(command).toContain(path.join(userData, 'integrations', 'session-context'))
  })
})

describe('hookCommand quoting', () => {
  it('quotes paths containing spaces and apostrophes', async () => {
    const mod = await load()
    const command = mod.hookCommand({
      execPath: "/Users/andrew's mac/Terminator",
      hookScriptPath: '/tmp/my hook.cjs',
      projectId: PROJECT_ID,
    })
    expect(command).toContain(`'/Users/andrew'\\''s mac/Terminator'`)
    expect(command).toContain(`'/tmp/my hook.cjs'`)
  })
})

// ── The owned block ─────────────────────────────────────────────────────────

const HOOK_OPTIONS = {
  execPath: '/bin/electron',
  hookScriptPath: '/tmp/hook.cjs',
  projectId: PROJECT_ID,
}

describe('installProjectHook — entries of earlier versions', () => {
  it('collapses an entry that ran the old session-start-hook.cjs into one', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: '/old/session-start-hook.cjs a' }],
            },
          ],
        },
      }),
      'utf8'
    )
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    const settings = readClaudeSettingsFile() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(JSON.stringify(settings)).not.toContain('/old/')
  })
})

describe('installProjectHook', () => {
  it('creates the settings file with a SessionStart hook', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)

    const settings = readClaudeSettingsFile() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(JSON.stringify(settings)).toContain('/tmp/hook.cjs')
  })

  it('keeps every SessionStart entry the operator already had', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }] }],
        },
      }),
      'utf8'
    )
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)

    const settings = readClaudeSettingsFile() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(2)
    expect(JSON.stringify(settings)).toContain('echo mine')
  })
})

describe('installProjectHook — other settings and repeats', () => {
  it('leaves unrelated settings and other hook events untouched', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        permissions: { allow: ['Bash(npm test *)'] },
        hooks: { PostToolUse: [{ matcher: 'Edit' }] },
      }),
      'utf8'
    )
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)

    const settings = readClaudeSettingsFile() as {
      permissions: unknown
      hooks: { PostToolUse: unknown }
    }
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test *)'] })
    expect(settings.hooks.PostToolUse).toEqual([{ matcher: 'Edit' }])
  })

  it('is idempotent — relinking does not stack up copies', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)

    const settings = readClaudeSettingsFile() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(1)
  })
})

describe('installProjectHook — what it refuses to touch', () => {
  it('never touches the shared, checked-in settings.json', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    const shared = path.join(projectDir, '.claude', 'settings.json')
    fs.writeFileSync(shared, '{"permissions":{"allow":[]}}', 'utf8')
    const before = fs.readFileSync(shared, 'utf8')

    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)

    expect(fs.readFileSync(shared, 'utf8')).toBe(before)
  })

  it('refuses rather than clobbering settings it cannot parse', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(settingsPath(), '{ this is not json', 'utf8')

    const mod = await load()
    await expect(mod.installProjectHook(projectDir, HOOK_OPTIONS)).rejects.toThrow()
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ this is not json')
  })

  it('fails loudly when the project directory cannot be written (FR-026)', async () => {
    // A file where `.claude` should be: no one can write the hook into it.
    fs.writeFileSync(path.join(projectDir, '.claude'), '')
    const mod = await load()
    await expect(mod.installProjectHook(projectDir, HOOK_OPTIONS)).rejects.toThrow()
  })
})

describe('removeProjectHook', () => {
  it('leaves the directory as it found it when we created everything (SC-010)', async () => {
    const before = fs.readdirSync(projectDir)
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    await mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)

    expect(fs.readdirSync(projectDir)).toEqual(before)
    expect(fs.existsSync(path.join(projectDir, '.claude'))).toBe(false)
  })

  it('restores a file that had other content, byte for byte in substance', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    const original = { permissions: { allow: ['Bash(npm test *)'] } }
    fs.writeFileSync(settingsPath(), `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    await mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)

    expect(readClaudeSettingsFile()).toEqual(original)
  })
})

describe('removeProjectHook — other tools and directories', () => {
  it("leaves another tool's SessionStart hook in place", async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }] }],
        },
      }),
      'utf8'
    )
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    await mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)

    const settings = readClaudeSettingsFile() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(JSON.stringify(settings)).toContain('echo mine')
  })

  it('keeps a .claude directory that has other things in it', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    fs.writeFileSync(path.join(projectDir, '.claude', 'settings.json'), '{}', 'utf8')
    await mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)

    expect(fs.existsSync(path.join(projectDir, '.claude'))).toBe(true)
    expect(fs.existsSync(settingsPath())).toBe(false)
  })
})

describe('removeProjectHook — nothing to remove', () => {
  it('is harmless when there is nothing to remove', async () => {
    const mod = await load()
    await expect(
      mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)
    ).resolves.toBeUndefined()
  })

  it('is harmless on settings it cannot parse', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(settingsPath(), 'not json', 'utf8')
    const mod = await load()
    await expect(
      mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)
    ).resolves.toBeUndefined()
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('not json')
  })

  it('is idempotent', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, HOOK_OPTIONS)
    await mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)
    await expect(
      mod.removeProjectHook(projectDir, HOOK_OPTIONS.hookScriptPath)
    ).resolves.toBeUndefined()
  })
})
