import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

const state = vi.hoisted(() => ({ background: false }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../../../src/main/background-mode', () => ({
  runsInBackground: () => state.background,
}))
vi.mock('../../../src/main/logger', () => ({
  logger: { warn: vi.fn() },
  makeLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import {
  connect,
  disconnect,
  registerWithClaude,
  registrationStatus,
  type ClaudeRun,
} from '../../../src/main/mcp/registration'
import { putAllowRule, removeAllowRule } from '../../../src/main/integrations/claude-settings'

let directory: string
let settingsFile: string
let runs: string[][]
let exitCode: number

const run: ClaudeRun = async (args) => {
  runs.push(args)
  return { exitCode, stderr: exitCode === 0 ? '' : 'claude: not found' }
}

const config = JSON.stringify({
  type: 'stdio',
  command: process.execPath,
  args: ['/data/mcp/mcp-relay.cjs', '/data/mcp.sock'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
})
const options = () => ({
  relayPath: '/data/mcp/mcp-relay.cjs',
  socketPath: '/data/mcp.sock',
  directory,
  settingsFile,
  run,
})
const register = () => registerWithClaude(options())
const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

beforeEach(() => {
  const home = makeTempDir('mcp-register-')
  directory = path.join(home, 'mcp')
  settingsFile = path.join(home, '.claude', 'settings.json')
  runs = []
  exitCode = 0
  state.background = false
})

describe('registerWithClaude', () => {
  it('removes any old entry, then adds the relay under terminator-dev, at user scope', async () => {
    await register()
    expect(runs).toEqual([
      ['mcp', 'remove', '--scope', 'user', 'terminator-dev'],
      ['mcp', 'add-json', '--scope', 'user', 'terminator-dev', config],
    ])
  })

  it('allows the server’s tools in the user settings', async () => {
    await register()
    expect(settings().permissions.allow).toEqual(['mcp__terminator-dev'])
  })
})

describe('registerWithClaude — on a later start', () => {
  it('does not run claude again when nothing changed', async () => {
    await register()
    runs = []
    await register()
    expect(runs).toEqual([])
  })

  it('registers again when the relay moved', async () => {
    await register()
    runs = []
    await registerWithClaude({
      relayPath: '/new/mcp-relay.cjs',
      socketPath: '/data/mcp.sock',
      directory,
      settingsFile,
      run,
    })
    expect(runs.map((args) => args[1])).toEqual(['remove', 'add-json'])
    expect(runs[1][5]).toContain('/new/mcp-relay.cjs')
  })
})

describe('registerWithClaude — when it must not or cannot run', () => {
  it('does nothing in a background (test) run', async () => {
    state.background = true
    await register()
    expect(runs).toEqual([])
    expect(fs.existsSync(settingsFile)).toBe(false)
  })

  it('does not throw when claude fails, and tries again on the next start', async () => {
    exitCode = 127
    await expect(register()).resolves.toBeUndefined()
    exitCode = 0
    runs = []
    await register()
    expect(runs.map((args) => args[1])).toEqual(['remove', 'add-json'])
  })
})

describe('putAllowRule', () => {
  it('keeps every other entry and key, and does not add the rule twice', async () => {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)'], deny: ['Read(.env)'] } })
    )
    await putAllowRule(settingsFile, 'mcp__terminator')
    await putAllowRule(settingsFile, 'mcp__terminator')
    expect(settings()).toEqual({
      model: 'opus',
      permissions: { allow: ['Bash(ls)', 'mcp__terminator'], deny: ['Read(.env)'] },
    })
  })
})

describe('registrationStatus', () => {
  it('is connected once the current server is registered, with the exact command to copy', async () => {
    await register()
    const status = await registrationStatus(options())
    expect(status).toEqual({
      state: 'connected',
      name: 'terminator-dev',
      command: `claude mcp add-json --scope user terminator-dev '${config}'`,
    })
  })

  it('is disconnected before anything was registered', async () => {
    expect((await registrationStatus(options())).state).toBe('disconnected')
  })

  it('is unavailable, in plain words, when claude is missing', async () => {
    exitCode = 127
    await register()
    expect(await registrationStatus(options())).toMatchObject({
      state: 'unavailable',
      reason: 'Claude Code is not installed: Terminator cannot find the claude command.',
    })
  })

  it('is unavailable with what claude said when the add fails', async () => {
    exitCode = 1
    await register()
    expect((await registrationStatus(options())).reason).toBe(
      'Claude Code could not add the server: claude: not found'
    )
  })
})

describe('disconnect', () => {
  it('removes the server and its allow rule, and says disconnected', async () => {
    await register()
    runs = []
    await disconnect(options())
    expect(runs).toEqual([['mcp', 'remove', '--scope', 'user', 'terminator-dev']])
    expect(settings().permissions.allow).toEqual([])
    expect((await registrationStatus(options())).state).toBe('disconnected')
  })

  it('stays disconnected on the next start', async () => {
    await register()
    await disconnect(options())
    runs = []
    await register()
    expect(runs).toEqual([])
    expect(settings().permissions.allow).toEqual([])
  })
})

describe('connect', () => {
  it('registers again after a disconnect', async () => {
    await register()
    await disconnect(options())
    runs = []
    await connect(options())
    expect(runs.map((args) => args[1])).toEqual(['remove', 'add-json'])
    expect(settings().permissions.allow).toEqual(['mcp__terminator-dev'])
    expect((await registrationStatus(options())).state).toBe('connected')
  })

  it('clears an earlier failure once the add works', async () => {
    exitCode = 127
    await register()
    exitCode = 0
    await connect(options())
    expect((await registrationStatus(options())).state).toBe('connected')
  })
})

describe('removeAllowRule', () => {
  it('removes only that rule and keeps every other key', async () => {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)', 'mcp__terminator'] } })
    )
    await removeAllowRule(settingsFile, 'mcp__terminator')
    expect(settings()).toEqual({ model: 'opus', permissions: { allow: ['Bash(ls)'] } })
  })

  it('leaves a missing settings file missing', async () => {
    await removeAllowRule(settingsFile, 'mcp__terminator')
    expect(fs.existsSync(settingsFile)).toBe(false)
  })
})
