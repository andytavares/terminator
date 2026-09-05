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

  // execFile, never a shell: the folder path is an argument, so a directory
  // with a space or a quote in its name cannot become a second command.
  it('runs the CLI directly with the folder as an argument', () => {
    expect(launchArgvFor({ ...cursor, cli: 'cursor' }, '/repos/app')).toEqual({
      command: 'cursor',
      args: ['/repos/app'],
    })
  })

  it('falls back to opening the mac app when there is no CLI', () => {
    expect(launchArgvFor({ ...cursor, cli: undefined }, '/repos/app')).toEqual({
      command: 'open',
      args: ['-a', cursor.macApp!, '/repos/app'],
    })
  })

  it('keeps a path with spaces as one argument', () => {
    const argv = launchArgvFor({ ...cursor, cli: 'cursor' }, '/Users/me/my repos/app')
    expect(argv.args).toEqual(['/Users/me/my repos/app'])
  })

  it('never builds a shell string', () => {
    const argv = launchArgvFor({ ...cursor, cli: 'cursor' }, '/repos/app; rm -rf /')
    expect(argv.command).toBe('cursor')
    expect(argv.args).toEqual(['/repos/app; rm -rf /'])
  })
})
