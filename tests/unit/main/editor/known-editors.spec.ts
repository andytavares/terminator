import { describe, it, expect } from 'vitest'
import { KNOWN_EDITORS, launchArgvFor, pickEditor } from '../../../../src/main/editor/known-editors'

describe('KNOWN_EDITORS', () => {
  it('lists each editor once, with an id, a name and something to launch', () => {
    expect(KNOWN_EDITORS.length).toBeGreaterThan(0)
    expect(new Set(KNOWN_EDITORS.map((e) => e.id)).size).toBe(KNOWN_EDITORS.length)
    for (const editor of KNOWN_EDITORS) {
      expect(editor.name).toBeTruthy()
      expect(editor.cli || editor.macApp).toBeTruthy()
    }
  })
})

describe('pickEditor', () => {
  // `available` answers "is this on the machine" — the caller probes the file
  // system, so the choosing itself stays pure and testable.
  const availableOnly =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id)

  it('returns nothing when no editor is installed', () => {
    expect(pickEditor(availableOnly(), undefined)).toBeNull()
  })

  it('picks the only installed editor', () => {
    expect(pickEditor(availableOnly('zed'), undefined)?.id).toBe('zed')
  })

  it('prefers the earlier entry when several are installed', () => {
    const first = KNOWN_EDITORS[0].id
    const second = KNOWN_EDITORS[1].id
    expect(pickEditor(availableOnly(second, first), undefined)?.id).toBe(first)
  })

  // A configured editor is the user's answer to "my default editor" and beats
  // whatever happens to be installed first.
  it('honours a configured editor over the detected one', () => {
    const configured = KNOWN_EDITORS[KNOWN_EDITORS.length - 1].id
    const chosen = pickEditor(availableOnly(KNOWN_EDITORS[0].id, configured), configured)
    expect(chosen?.id).toBe(configured)
  })

  it('falls back to detection when the configured editor is not installed', () => {
    const chosen = pickEditor(availableOnly(KNOWN_EDITORS[0].id), 'zed')
    expect(chosen?.id).toBe(KNOWN_EDITORS[0].id)
  })

  it('falls back to detection when the configured id is not one we know', () => {
    const chosen = pickEditor(availableOnly(KNOWN_EDITORS[0].id), 'notepad-plus-plus')
    expect(chosen?.id).toBe(KNOWN_EDITORS[0].id)
  })

  it('ignores an empty configured value', () => {
    expect(pickEditor(availableOnly('zed'), '')?.id).toBe('zed')
  })
})

describe('launchArgvFor', () => {
  const cursor = KNOWN_EDITORS.find((e) => e.id === 'cursor')!

  /**
   * On macOS `open -a` is preferred over the editor's own CLI, even when the
   * CLI is installed. VS Code-family launchers (`code`, `cursor`, `windsurf`)
   * open the folder in an existing window and leave the app where it was, so
   * clicking the menu item looked like it did nothing. `open -a` raises the
   * app as well — and it needs no PATH, which a Finder-launched app does not
   * reliably have.
   */
  it('opens and raises the app on macOS, even when a CLI exists', () => {
    expect(launchArgvFor({ ...cursor, cli: 'cursor' }, '/repos/app', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', 'Cursor', '/repos/app'],
    })
  })

  it('uses the CLI on macOS when the editor ships no application', () => {
    expect(launchArgvFor({ id: 'x', name: 'X', cli: 'x-cli' }, '/repos/app', 'darwin')).toEqual({
      command: 'x-cli',
      args: ['/repos/app'],
    })
  })

  it('uses the CLI off macOS, where `open` does not exist', () => {
    expect(launchArgvFor({ ...cursor, cli: 'cursor' }, '/repos/app', 'linux')).toEqual({
      command: 'cursor',
      args: ['/repos/app'],
    })
  })

  it('falls back to the application when there is no CLI', () => {
    expect(launchArgvFor({ ...cursor, cli: undefined }, '/repos/app', 'darwin')).toEqual({
      command: 'open',
      args: ['-a', cursor.macApp!, '/repos/app'],
    })
  })

  it('keeps a path with spaces as one argument', () => {
    const argv = launchArgvFor({ ...cursor, cli: 'cursor' }, '/Users/me/my repos/app', 'darwin')
    expect(argv.args.at(-1)).toBe('/Users/me/my repos/app')
  })

  it('never builds a shell string', () => {
    const argv = launchArgvFor({ ...cursor, cli: 'cursor' }, '/repos/app; rm -rf /', 'darwin')
    expect(argv.command).toBe('open')
    expect(argv.args.at(-1)).toBe('/repos/app; rm -rf /')
  })
})
