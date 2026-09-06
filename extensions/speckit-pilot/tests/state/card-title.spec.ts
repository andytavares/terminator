import { describe, it, expect } from 'vitest'
import { displayTitle } from '../../src/state/card-title'

// Backlog cards carried human sentences while Done showed folder slugs like
// 001-extension-isolation — the same board naming the same objects two ways.

describe('displayTitle', () => {
  it('leaves a written title exactly as written', () => {
    expect(displayTitle('Make all text in the application red')).toBe(
      'Make all text in the application red'
    )
  })

  it('leaves punctuation and casing alone', () => {
    expect(displayTitle("Don't lose the user's draft — ever")).toBe(
      "Don't lose the user's draft — ever"
    )
  })

  it('reads a numbered feature slug as a sentence', () => {
    expect(displayTitle('001-extension-isolation')).toBe('Extension isolation')
  })

  it('reads a timestamped slug as a sentence', () => {
    expect(displayTitle('20260905-143022-fix-the-thing')).toBe('Fix the thing')
  })

  it('reads a plain slug as a sentence', () => {
    expect(displayTitle('declutter-sidebar')).toBe('Declutter sidebar')
  })

  it('reads a branch-shaped slug as a sentence', () => {
    expect(displayTitle('fix/sidebar-sorting')).toBe('Fix sidebar sorting')
  })

  // A real sentence contains spaces or capitals and never matches the slug
  // pattern, so humanising cannot reach it.
  it.each(['Add user auth', 'fix payment timeout bug', 'A one-liner, with punctuation.'])(
    'does not mangle %s',
    (title) => {
      expect(displayTitle(title)).toBe(title)
    }
  )

  describe('when there is no title at all', () => {
    it('falls back to the directory', () => {
      expect(displayTitle('', 'specs/036-extension-ux-remediation')).toBe(
        'Extension ux remediation'
      )
    })

    it('says so rather than rendering an empty card', () => {
      expect(displayTitle('')).toBe('Untitled card')
      expect(displayTitle('   ')).toBe('Untitled card')
    })
  })
})
