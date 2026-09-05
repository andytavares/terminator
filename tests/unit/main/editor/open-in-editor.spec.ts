import { describe, it, expect, vi, beforeEach } from 'vitest'

const execFile = vi.fn()
const access = vi.fn()

vi.mock('node:child_process', () => ({ execFile: (...a: unknown[]) => execFile(...a) }))
vi.mock('node:fs/promises', () => ({
  access: (...a: unknown[]) => access(...a),
  constants: { F_OK: 0, X_OK: 1 },
}))

import { detectEditor, openInEditor } from '../../../../src/main/editor/open-in-editor'

/** Every probed path resolves; nothing exists unless listed. */
function present(...paths: string[]): void {
  access.mockImplementation(async (p: string) => {
    if (paths.some((allowed) => p === allowed)) return undefined
    throw new Error('ENOENT')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PATH = '/usr/local/bin:/usr/bin'
  execFile.mockImplementation((_c: string, _a: string[], cb: (e: Error | null) => void) => cb(null))
})

describe('detectEditor', () => {
  it('finds an editor by its CLI on PATH', async () => {
    present('/usr/local/bin/cursor')
    expect((await detectEditor())?.id).toBe('cursor')
  })

  it('finds an editor by its application when it ships no CLI on PATH', async () => {
    present('/Applications/Zed.app')
    expect((await detectEditor())?.id).toBe('zed')
  })

  it('returns nothing when the machine has none it recognises', async () => {
    present()
    expect(await detectEditor()).toBeNull()
  })

  it('honours a configured editor over the one it would have picked', async () => {
    present('/usr/local/bin/cursor', '/usr/local/bin/subl')
    expect((await detectEditor('sublime'))?.id).toBe('sublime')
  })

  it('falls back to detection when the configured editor is not installed', async () => {
    present('/usr/local/bin/cursor')
    expect((await detectEditor('sublime'))?.id).toBe('cursor')
  })

  it('searches every PATH entry', async () => {
    present('/usr/bin/code')
    expect((await detectEditor())?.id).toBe('vscode')
  })

  it('survives an empty PATH', async () => {
    process.env.PATH = ''
    present('/Applications/Cursor.app')
    expect((await detectEditor())?.id).toBe('cursor')
  })
})

describe('openInEditor', () => {
  it('launches the CLI with the folder as a single argument', async () => {
    present('/repos/app', '/usr/local/bin/cursor')
    const result = await openInEditor('/repos/app')
    expect(execFile).toHaveBeenCalledWith('cursor', ['/repos/app'], expect.any(Function))
    expect(result).toEqual({ ok: true, editor: 'Cursor' })
  })

  it('opens the application when the editor ships no CLI', async () => {
    present('/repos/app', '/Applications/Xcode.app')
    await openInEditor('/repos/app')
    expect(execFile).toHaveBeenCalledWith(
      'open',
      ['-a', 'Xcode', '/repos/app'],
      expect.any(Function)
    )
  })

  // The path is an argument, never part of a shell string, so a directory name
  // cannot become a second command.
  it('passes a hostile path through as one argument', async () => {
    const nasty = '/repos/app; rm -rf ~'
    present(nasty, '/usr/local/bin/cursor')
    await openInEditor(nasty)
    expect(execFile).toHaveBeenCalledWith('cursor', [nasty], expect.any(Function))
  })

  it('keeps a path with spaces intact', async () => {
    const spaced = '/Users/me/my repos/app'
    present(spaced, '/usr/local/bin/cursor')
    await openInEditor(spaced)
    expect(execFile).toHaveBeenCalledWith('cursor', [spaced], expect.any(Function))
  })

  it('refuses a folder that is not there rather than launching anything', async () => {
    present('/usr/local/bin/cursor')
    expect(await openInEditor('/gone')).toEqual({ error: 'FOLDER_NOT_FOUND' })
    expect(execFile).not.toHaveBeenCalled()
  })

  it('says so when the machine has no editor it recognises', async () => {
    present('/repos/app')
    expect(await openInEditor('/repos/app')).toEqual({ error: 'NO_EDITOR_FOUND' })
    expect(execFile).not.toHaveBeenCalled()
  })

  it('reports a launch failure rather than throwing', async () => {
    present('/repos/app', '/usr/local/bin/cursor')
    execFile.mockImplementation((_c: string, _a: string[], cb: (e: Error) => void) =>
      cb(new Error('spawn failed'))
    )
    expect(await openInEditor('/repos/app')).toEqual({ error: 'spawn failed' })
  })

  it('uses the configured editor when one is set', async () => {
    present('/repos/app', '/usr/local/bin/cursor', '/usr/local/bin/subl')
    const result = await openInEditor('/repos/app', 'sublime')
    expect(execFile).toHaveBeenCalledWith('subl', ['/repos/app'], expect.any(Function))
    expect(result).toEqual({ ok: true, editor: 'Sublime Text' })
  })
})
