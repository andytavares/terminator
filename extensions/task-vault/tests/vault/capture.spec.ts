import { describe, it, expect } from 'vitest'
import { validateCaptureText, suggestDestination } from '../../src/vault/parser'

describe('validateCaptureText', () => {
  it('accepts valid text', () => {
    expect(validateCaptureText('Buy groceries')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateCaptureText('')).toBe(false)
  })

  it('rejects whitespace-only text', () => {
    expect(validateCaptureText('   ')).toBe(false)
    expect(validateCaptureText('\t\n')).toBe(false)
  })
})

describe('suggestDestination tag detection', () => {
  const emptyIndex = { tasks: [] }

  it('detects @project tag', () => {
    const result = suggestDestination('Fix bug @terminator', emptyIndex)
    expect(result.tags.project).toBe('terminator')
  })

  it('detects +context tag', () => {
    const result = suggestDestination('Call dentist +phone', emptyIndex)
    expect(result.tags.context).toBe('phone')
  })

  it('detects #area tag', () => {
    const result = suggestDestination('File taxes #finance', emptyIndex)
    expect(result.tags.area).toBe('finance')
  })

  it('suggests destination file when area matches an indexed task', () => {
    const index = {
      tasks: [{ filePath: '/vault/areas/finance.md', area: 'finance', project: undefined }],
    }
    const result = suggestDestination('Submit form #finance', index)
    expect(result.destination).toBe('/vault/areas/finance.md')
  })

  it('returns no destination when no area match', () => {
    const result = suggestDestination('Random task', emptyIndex)
    expect(result.destination).toBeUndefined()
  })
})
