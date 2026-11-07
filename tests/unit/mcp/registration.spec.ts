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

import { registerWithClaude, type ClaudeRun } from '../../../src/main/mcp/registration'
import { putAllowRule } from '../../../src/main/integrations/claude-settings'

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
const register = () =>
  registerWithClaude({
    relayPath: '/data/mcp/mcp-relay.cjs',
    socketPath: '/data/mcp.sock',
    directory,
    settingsFile,
    run,
  })
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
