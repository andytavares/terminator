import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMuteStore } from '../../../src/runtime/feed/mutes.js'

// Which runs are allowed to interrupt you. A mute you have to set again after
// every restart is one you stop bothering with, and then notifications get
// turned off wholesale — which is the failure this is here to avoid.

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutes-'))
  file = join(dir, 'mutes.json')
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('muting', () => {
  it('starts with nothing muted', () => {
    expect(createMuteStore(file).list()).toEqual([])
  })

  it('keeps a rule across a restart', () => {
    createMuteStore(file).add({ sessionId: 'session-1' })
    expect(createMuteStore(file).list()).toEqual([{ sessionId: 'session-1' }])
  })

  it('ignores muting the same thing twice', () => {
    const store = createMuteStore(file)
    store.add({ sessionId: 'session-1' })
    store.add({ sessionId: 'session-1' })
    expect(store.list()).toHaveLength(1)
  })

  it('treats a rule about an author as different from one about a run', () => {
    const store = createMuteStore(file)
    store.add({ sessionId: 'session-1' })
    store.add({ author: 'console' })
    expect(store.list()).toHaveLength(2)
  })

  it('unmutes one without touching the others', () => {
    const store = createMuteStore(file)
    store.add({ sessionId: 'session-1' })
    store.add({ sessionId: 'session-2' })
    store.remove({ sessionId: 'session-1' })
    expect(store.list()).toEqual([{ sessionId: 'session-2' }])
  })

  it('clears everything', () => {
    const store = createMuteStore(file)
    store.add({ sessionId: 'session-1' })
    store.clear()
    expect(store.list()).toEqual([])
  })
})

describe('a file that is not what was written', () => {
  it('reads nothing rather than throwing on nonsense', () => {
    writeFileSync(file, 'not json')
    expect(createMuteStore(file).list()).toEqual([])
  })

  it('reads nothing when it is not a list', () => {
    writeFileSync(file, '{"sessionId":"session-1"}')
    expect(createMuteStore(file).list()).toEqual([])
  })

  it('drops a rule naming an author that does not exist', () => {
    // The file is small and hand-editable, and a malformed rule would silently
    // mute everything or nothing.
    writeFileSync(file, JSON.stringify([{ author: 'somebody' }, { sessionId: 'session-1' }]))
    expect(createMuteStore(file).list()).toEqual([{ sessionId: 'session-1' }])
  })

  it('still applies a mute it could not save', () => {
    // Failing the click over an unwritable file would be worse than losing the
    // rule on restart.
    const store = createMuteStore(join(dir, 'no-such-dir', 'x', 'mutes.json'))
    expect(() => store.add({ sessionId: 'session-1' })).not.toThrow()
  })
})
