import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  NOTES_CHANGED_CHANNEL,
  ORIGIN_ID,
  isForeignChange,
  onForeignNoteChange,
  parseNoteChangedEvent,
  type NoteChangedEvent,
} from '../../../src/editor/noteSync'

function makeEvent(overrides: Partial<NoteChangedEvent> = {}): NoteChangedEvent {
  return {
    id: 'note-1',
    title: 'Title',
    body: 'body',
    tags: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    originId: 'some-other-surface',
    ...overrides,
  }
}

describe('parseNoteChangedEvent', () => {
  it('parses a well-formed payload', () => {
    expect(parseNoteChangedEvent(makeEvent())).toEqual(makeEvent())
  })

  it('rejects non-objects', () => {
    expect(parseNoteChangedEvent(null)).toBeNull()
    expect(parseNoteChangedEvent('nope')).toBeNull()
    expect(parseNoteChangedEvent(undefined)).toBeNull()
  })

  it('rejects payloads without an id or body', () => {
    expect(parseNoteChangedEvent({ body: 'b' })).toBeNull()
    expect(parseNoteChangedEvent({ id: 'note-1' })).toBeNull()
  })

  it('defaults the optional fields rather than dropping the event', () => {
    const parsed = parseNoteChangedEvent({ id: 'note-1', body: 'b' })
    expect(parsed).toEqual({
      id: 'note-1',
      title: '',
      body: 'b',
      tags: [],
      updatedAt: '',
      originId: null,
    })
  })

  it('keeps an empty body, which is a legitimate note state', () => {
    expect(parseNoteChangedEvent({ id: 'note-1', body: '' })?.body).toBe('')
  })
})

describe('isForeignChange', () => {
  it('is false for this surface own write', () => {
    expect(isForeignChange(makeEvent({ originId: ORIGIN_ID }))).toBe(false)
  })

  it('is true for another surface write', () => {
    expect(isForeignChange(makeEvent({ originId: 'other' }))).toBe(true)
  })

  it('is true when the origin is unknown', () => {
    expect(isForeignChange(makeEvent({ originId: null }))).toBe(true)
  })
})

describe('onForeignNoteChange', () => {
  const off = vi.fn()
  let handlers: Array<(data: unknown) => void>

  beforeEach(() => {
    handlers = []
    off.mockClear()
    ;(globalThis as unknown as { window: unknown }).window = {
      electronAPI: {
        extensionBridge: {
          on: vi.fn((channel: string, handler: (data: unknown) => void) => {
            expect(channel).toBe(NOTES_CHANGED_CHANNEL)
            handlers.push(handler)
            return off
          }),
        },
      },
    }
  })

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('delivers changes written by another surface', () => {
    const handler = vi.fn()
    onForeignNoteChange(handler)
    handlers[0](makeEvent({ body: 'from the pop-out' }))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ body: 'from the pop-out' }))
  })

  it('swallows the echo of this surface own write', () => {
    const handler = vi.fn()
    onForeignNoteChange(handler)
    handlers[0](makeEvent({ originId: ORIGIN_ID }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores malformed payloads', () => {
    const handler = vi.fn()
    onForeignNoteChange(handler)
    handlers[0]({ nonsense: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns the unsubscribe function from the bridge', () => {
    expect(onForeignNoteChange(vi.fn())).toBe(off)
  })
})
