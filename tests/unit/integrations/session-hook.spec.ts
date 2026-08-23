import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/integrations/session-hook')
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
let projectDir: string

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hook-ud-'))
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hook-proj-'))
})

function settingsPath(): string {
  return path.join(projectDir, '.claude', 'settings.local.json')
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
}

// ── The script itself ───────────────────────────────────────────────────────
// Run for real with node: the whole point of this file is what the runtime
// receives on stdout, and asserting on the source string would prove nothing.

describe('the hook script, executed', () => {
  async function runScript(contextFileContents: string | null): Promise<string> {
    const mod = await load()
    const scriptPath = await mod.installHookScript(userData)
    const contextFile = path.join(userData, 'ctx.json')
    if (contextFileContents !== null) fs.writeFileSync(contextFile, contextFileContents, 'utf8')
    return execFileSync(process.execPath, [scriptPath, contextFile], { encoding: 'utf8' })
  }

  it('emits hookEventName — without it the runtime ignores the whole object', async () => {
    const out = await runScript(JSON.stringify({ markdown: '# TAV-42', key: 'TAV-42' }))
    expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe('SessionStart')
  })

  it('carries the context as additionalContext', async () => {
    const out = await runScript(
      JSON.stringify({ markdown: '# Linked issue: TAV-42', key: 'TAV-42' })
    )
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toBe('# Linked issue: TAV-42')
  })

  it('names the session after the issue', async () => {
    const out = await runScript(JSON.stringify({ markdown: 'x', key: 'TAV-42' }))
    expect(JSON.parse(out).hookSpecificOutput.sessionTitle).toBe('TAV-42')
  })

  it('prints nothing and exits 0 when the context file is missing', async () => {
    expect(await runScript(null)).toBe('')
  })

  it('prints nothing and exits 0 when the context file is malformed', async () => {
    expect(await runScript('{{{ not json')).toBe('')
  })

  it('prints nothing when the context has no markdown', async () => {
    expect(await runScript(JSON.stringify({ key: 'TAV-42' }))).toBe('')
    expect(await runScript(JSON.stringify({ markdown: '', key: 'TAV-42' }))).toBe('')
  })

  it('survives a context file that is valid JSON but not an object', async () => {
    expect(await runScript('"just a string"')).toBe('')
    expect(await runScript('null')).toBe('')
  })
})

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
  })

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

describe('installProjectHook', () => {
  const options = {
    execPath: '/bin/electron',
    hookScriptPath: '/tmp/hook.cjs',
    projectId: PROJECT_ID,
  }

  it('creates the settings file with a SessionStart hook', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, options)

    const settings = readSettings() as { hooks: { SessionStart: unknown[] } }
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
    await mod.installProjectHook(projectDir, options)

    const settings = readSettings() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(2)
    expect(JSON.stringify(settings)).toContain('echo mine')
  })

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
    await mod.installProjectHook(projectDir, options)

    const settings = readSettings() as Record<string, never>
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test *)'] })
    expect(settings.hooks.PostToolUse).toEqual([{ matcher: 'Edit' }])
  })

  it('is idempotent — relinking does not stack up copies', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, options)
    await mod.installProjectHook(projectDir, options)
    await mod.installProjectHook(projectDir, options)

    const settings = readSettings() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(1)
  })

  it('never touches the shared, checked-in settings.json', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    const shared = path.join(projectDir, '.claude', 'settings.json')
    fs.writeFileSync(shared, '{"permissions":{"allow":[]}}', 'utf8')
    const before = fs.readFileSync(shared, 'utf8')

    const mod = await load()
    await mod.installProjectHook(projectDir, options)

    expect(fs.readFileSync(shared, 'utf8')).toBe(before)
  })

  it('refuses rather than clobbering settings it cannot parse', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(settingsPath(), '{ this is not json', 'utf8')

    const mod = await load()
    await expect(mod.installProjectHook(projectDir, options)).rejects.toThrow()
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ this is not json')
  })

  it('fails loudly when the project directory cannot be written (FR-026)', async () => {
    fs.chmodSync(projectDir, 0o500)
    const mod = await load()
    await expect(mod.installProjectHook(projectDir, options)).rejects.toThrow()
    fs.chmodSync(projectDir, 0o700)
  })
})

describe('removeProjectHook', () => {
  const options = {
    execPath: '/bin/electron',
    hookScriptPath: '/tmp/hook.cjs',
    projectId: PROJECT_ID,
  }

  it('leaves the directory as it found it when we created everything (SC-010)', async () => {
    const before = fs.readdirSync(projectDir)
    const mod = await load()
    await mod.installProjectHook(projectDir, options)
    await mod.removeProjectHook(projectDir, options.hookScriptPath)

    expect(fs.readdirSync(projectDir)).toEqual(before)
    expect(fs.existsSync(path.join(projectDir, '.claude'))).toBe(false)
  })

  it('restores a file that had other content, byte for byte in substance', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    const original = { permissions: { allow: ['Bash(npm test *)'] } }
    fs.writeFileSync(settingsPath(), `${JSON.stringify(original, null, 2)}\n`, 'utf8')

    const mod = await load()
    await mod.installProjectHook(projectDir, options)
    await mod.removeProjectHook(projectDir, options.hookScriptPath)

    expect(readSettings()).toEqual(original)
  })

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
    await mod.installProjectHook(projectDir, options)
    await mod.removeProjectHook(projectDir, options.hookScriptPath)

    const settings = readSettings() as { hooks: { SessionStart: unknown[] } }
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(JSON.stringify(settings)).toContain('echo mine')
  })

  it('keeps a .claude directory that has other things in it', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, options)
    fs.writeFileSync(path.join(projectDir, '.claude', 'settings.json'), '{}', 'utf8')
    await mod.removeProjectHook(projectDir, options.hookScriptPath)

    expect(fs.existsSync(path.join(projectDir, '.claude'))).toBe(true)
    expect(fs.existsSync(settingsPath())).toBe(false)
  })

  it('is harmless when there is nothing to remove', async () => {
    const mod = await load()
    await expect(mod.removeProjectHook(projectDir, options.hookScriptPath)).resolves.toBeUndefined()
  })

  it('is harmless on settings it cannot parse', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'))
    fs.writeFileSync(settingsPath(), 'not json', 'utf8')
    const mod = await load()
    await expect(mod.removeProjectHook(projectDir, options.hookScriptPath)).resolves.toBeUndefined()
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('not json')
  })

  it('is idempotent', async () => {
    const mod = await load()
    await mod.installProjectHook(projectDir, options)
    await mod.removeProjectHook(projectDir, options.hookScriptPath)
    await expect(mod.removeProjectHook(projectDir, options.hookScriptPath)).resolves.toBeUndefined()
  })
})
