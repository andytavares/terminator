import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../../src/main/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { windowViewUsageId } from '../../../../src/main/extensions/extension-usage'

const NOTEPAD_VIEWS = ['notepad-note', 'notepad-diagram']

describe('windowViewUsageId', () => {
  it('names the manifest window view, never the item in the key', () => {
    expect(windowViewUsageId('notepad-note-3f2a-91bc', NOTEPAD_VIEWS)).toBe('notepad-note')
    expect(windowViewUsageId('notepad-diagram-77', NOTEPAD_VIEWS)).toBe('notepad-diagram')
  })

  it('takes a key that is the id itself', () => {
    expect(windowViewUsageId('pr-review', ['pr-review'])).toBe('pr-review')
  })

  it('is null for a key no window view declares', () => {
    expect(windowViewUsageId('notepad-notes', NOTEPAD_VIEWS)).toBeNull()
    expect(windowViewUsageId('pr-review', [])).toBeNull()
  })
})
