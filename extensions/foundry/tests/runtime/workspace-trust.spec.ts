import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ensureTrusted, claudeConfigPath } from '../../src/runtime/workspace-trust.js'

// Claude Code shows its workspace trust dialog for a directory it has not
// seen, "in interactive sessions only" — and Foundry runs interactively on
// purpose, because an agent in a terminal you can go and type at is the whole
// design. So every launch met that dialog and sat there for ever: the process
// up, the register holding it, the graph saying `running`, and no work ever
// beginning. A live run showed an agent at 0% CPU with no transcript at all.

let home: string
const REPO = '/repos/app'

function writeConfig(value: unknown): void {
  fs.writeFileSync(claudeConfigPath(home), JSON.stringify(value, null, 2))
}

function readConfig(): Record<string, never> {
  return JSON.parse(fs.readFileSync(claudeConfigPath(home), 'utf8')) as Record<string, never>
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-trust-'))
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

describe('ensureTrusted', () => {
  it('trusts a repository Claude Code has never seen', () => {
    writeConfig({ projects: {} })
    expect(ensureTrusted(REPO, home)).toEqual({ changed: true })
    const entry = readConfig().projects[REPO] as unknown as Record<string, unknown>
    expect(entry.hasTrustDialogAccepted).toBe(true)
  })

  it('trusts one whose entry exists and says no', () => {
    writeConfig({ projects: { [REPO]: { hasTrustDialogAccepted: false } } })
    expect(ensureTrusted(REPO, home)).toEqual({ changed: true })
  })

  it('leaves an already-trusted one alone, so a run does not rewrite the file every time', () => {
    writeConfig({ projects: { [REPO]: { hasTrustDialogAccepted: true } } })
    expect(ensureTrusted(REPO, home)).toEqual({ changed: false, reason: 'already trusted' })
  })

  it('keeps everything else in the project entry', () => {
    writeConfig({
      projects: {
        [REPO]: { allowedTools: ['Read'], lastCost: 1.5, hasTrustDialogAccepted: false },
      },
    })
    ensureTrusted(REPO, home)
    const entry = readConfig().projects[REPO] as unknown as Record<string, unknown>
    expect(entry.allowedTools).toEqual(['Read'])
    expect(entry.lastCost).toBe(1.5)
    expect(entry.hasTrustDialogAccepted).toBe(true)
  })

  it('keeps every other project, and everything outside projects', () => {
    writeConfig({
      numStartups: 41,
      oauthAccount: { emailAddress: 'someone@example.com' },
      projects: { '/repos/other': { hasTrustDialogAccepted: true, lastCost: 2 } },
    })
    ensureTrusted(REPO, home)
    const config = readConfig() as unknown as Record<string, never>
    expect(config.numStartups).toBe(41)
    expect(config.oauthAccount).toEqual({ emailAddress: 'someone@example.com' })
    expect(config.projects['/repos/other']).toEqual({ hasTrustDialogAccepted: true, lastCost: 2 })
  })

  it('never creates the file — a machine with no Claude Code config is not ours to set up', () => {
    expect(ensureTrusted(REPO, home)).toEqual({ changed: false, reason: 'no config to amend' })
    expect(fs.existsSync(claudeConfigPath(home))).toBe(false)
  })

  it('leaves a config it cannot parse exactly as it found it', () => {
    fs.writeFileSync(claudeConfigPath(home), '{ this is not json')
    expect(ensureTrusted(REPO, home)).toEqual({ changed: false, reason: 'no config to amend' })
    expect(fs.readFileSync(claudeConfigPath(home), 'utf8')).toBe('{ this is not json')
  })

  it('refuses a config that is not an object', () => {
    writeConfig(['not', 'a', 'config'])
    expect(ensureTrusted(REPO, home)).toEqual({ changed: false, reason: 'no config to amend' })
  })

  it('does nothing for an empty path', () => {
    writeConfig({ projects: {} })
    expect(ensureTrusted('', home)).toEqual({ changed: false, reason: 'no config to amend' })
  })

  it('adds a projects map to a config that has none', () => {
    writeConfig({ numStartups: 1 })
    expect(ensureTrusted(REPO, home)).toEqual({ changed: true })
    const entry = readConfig().projects[REPO] as unknown as Record<string, unknown>
    expect(entry.hasTrustDialogAccepted).toBe(true)
  })

  it('leaves no temporary file behind', () => {
    writeConfig({ projects: {} })
    ensureTrusted(REPO, home)
    expect(fs.readdirSync(home).filter((f) => f.includes('tmp'))).toEqual([])
  })
})

// macOS hands out two paths for the same directory — `/var/folders/…` and
// `/private/var/folders/…` — and this config is keyed by string. Trusting only
// the name we happened to be given leaves the agent at the dialog whenever the
// runtime resolves the other one, which is a coin flip nobody would ever debug.
describe('a directory with two names', () => {
  it('trusts both the path it was given and the one it resolves to', () => {
    const real = fs.mkdtempSync(path.join(home, 'real-'))
    const link = path.join(home, 'link')
    fs.symlinkSync(real, link)
    writeConfig({ projects: {} })

    expect(ensureTrusted(link, home)).toEqual({ changed: true })
    const projects = readConfig().projects as unknown as Record<string, { [k: string]: unknown }>
    expect(projects[link]?.hasTrustDialogAccepted).toBe(true)
    expect(projects[fs.realpathSync(link)]?.hasTrustDialogAccepted).toBe(true)
  })

  it('adds the name it was given when only the resolved one is trusted', () => {
    const real = fs.mkdtempSync(path.join(home, 'real-'))
    const link = path.join(home, 'link')
    fs.symlinkSync(real, link)
    writeConfig({ projects: { [fs.realpathSync(link)]: { hasTrustDialogAccepted: true } } })
    expect(ensureTrusted(link, home)).toEqual({ changed: true })
    const projects = readConfig().projects as unknown as Record<string, { [k: string]: unknown }>
    expect(projects[link]?.hasTrustDialogAccepted).toBe(true)
  })

  it('does not rewrite the file when both names are already trusted', () => {
    const real = fs.mkdtempSync(path.join(home, 'real-'))
    const link = path.join(home, 'link')
    fs.symlinkSync(real, link)
    writeConfig({
      projects: {
        [link]: { hasTrustDialogAccepted: true },
        [fs.realpathSync(link)]: { hasTrustDialogAccepted: true },
      },
    })
    expect(ensureTrusted(link, home)).toEqual({ changed: false, reason: 'already trusted' })
  })

  it('writes one entry for a path that is already its own real name', () => {
    writeConfig({ projects: {} })
    ensureTrusted(REPO, home)
    expect(Object.keys(readConfig().projects)).toEqual([REPO])
  })
})
