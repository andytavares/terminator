import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

let userData: string
let home: string

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'home' ? home : userData) },
}))

async function load() {
  vi.resetModules()
  return import('../../../src/main/agents/agent-ask-hook')
}

beforeEach(() => {
  userData = makeTempDir('ask-hook-ud-')
  home = makeTempDir('ask-hook-home-')
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
async function run(
  payload: unknown,
  env: Record<string, string> = { TERMINATOR_SESSION_ID: 's1' }
) {
  const mod = await load()
  const scriptPath = await mod.installAskScript(userData)
  const dir = path.join(userData, 'agent-sessions')
  const out = execFileSync(process.execPath, [scriptPath, dir], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, ...env },
  })
  const asks = path.join(dir, 'asks')
  return { out, asks, files: fs.existsSync(asks) ? fs.readdirSync(asks) : [] }
}

describe('the ask script, executed', () => {
  it('writes a notification under the terminal it ran in, and says nothing', async () => {
    const { out, asks } = await run(NOTIFICATION)
    expect(out).toBe('')
    const written = JSON.parse(fs.readFileSync(path.join(asks, 's1.json'), 'utf8'))
    expect(written).toMatchObject({
      terminal: 's1',
      event: 'notification',
      message: 'Claude needs your permission to use Bash',
      notificationType: 'permission_prompt',
    })
    expect(Date.parse(written.at)).not.toBeNaN()
  })

  it('writes a stop with no message and no type', async () => {
    const { asks } = await run({ hook_event_name: 'Stop', session_id: 'abc' })
    expect(JSON.parse(fs.readFileSync(path.join(asks, 's1.json'), 'utf8'))).toMatchObject({
      event: 'stop',
      message: '',
      notificationType: null,
    })
  })
})

describe('the ask script, executed — input it cannot use', () => {
  it.each([
    ['garbage', 'not json at all', { TERMINATOR_SESSION_ID: 's1' }],
    ['empty input', '', { TERMINATOR_SESSION_ID: 's1' }],
    ['another event', { hook_event_name: 'SessionStart' }, { TERMINATOR_SESSION_ID: 's1' }],
    ['a terminal this app does not own', NOTIFICATION, { TERMINATOR_SESSION_ID: '' }],
  ])('is silent and writes nothing for %s', async (_label, payload, env) => {
    const { out, files } = await run(payload, env)
    expect(out).toBe('')
    expect(files).toEqual([])
  })

  it('is silent when it cannot write', async () => {
    const mod = await load()
    const scriptPath = await mod.installAskScript(userData)
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

describe('installing the ask hooks', () => {
  it('adds a Notification and a Stop entry and keeps the operator’s own', async () => {
    const settings = path.join(home, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(settings), { recursive: true })
    fs.writeFileSync(
      settings,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } })
    )
    const mod = await load()
    const scriptPath = await mod.installAskScript(userData)
    await mod.installAskHooks({ execPath: process.execPath, scriptPath })
    await mod.installAskHooks({ execPath: process.execPath, scriptPath })
    const hooks = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks
    expect(hooks.Notification).toHaveLength(1)
    expect(hooks.Stop).toHaveLength(2)
    expect(JSON.stringify(hooks.Stop)).toContain('mine.sh')
    expect(hooks.Notification[0].hooks[0].command).toContain('agent-ask-hook.cjs')
  })
})
