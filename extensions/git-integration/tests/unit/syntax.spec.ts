import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHighlight, mockHighlightAuto, mockGetLanguage } = vi.hoisted(() => ({
  mockHighlight: vi.fn(),
  mockHighlightAuto: vi.fn(),
  mockGetLanguage: vi.fn(),
}))

vi.mock('highlight.js', () => ({
  default: {
    highlight: mockHighlight,
    highlightAuto: mockHighlightAuto,
    getLanguage: mockGetLanguage,
  },
}))

import { langFromBlockId, highlightBlock, highlightLine } from '../../src/utils/syntax'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetLanguage.mockReturnValue(true)
  mockHighlight.mockReturnValue({ value: '<highlighted>' })
  mockHighlightAuto.mockReturnValue({ value: '<auto>' })
})

describe('langFromBlockId', () => {
  it('maps .ts extension to typescript', () => {
    expect(langFromBlockId('src/foo.ts#0')).toBe('typescript')
  })

  it('maps .tsx extension to typescript', () => {
    expect(langFromBlockId('src/foo.tsx#1')).toBe('typescript')
  })

  it('maps .js extension to javascript', () => {
    expect(langFromBlockId('src/foo.js#0')).toBe('javascript')
  })

  it('maps .jsx extension to javascript', () => {
    expect(langFromBlockId('src/foo.jsx#0')).toBe('javascript')
  })

  it('maps .py extension to python', () => {
    expect(langFromBlockId('src/foo.py#0')).toBe('python')
  })

  it('maps .go extension to go', () => {
    expect(langFromBlockId('src/foo.go#0')).toBe('go')
  })

  it('maps .rs extension to rust', () => {
    expect(langFromBlockId('src/foo.rs#0')).toBe('rust')
  })

  it('maps .json extension to json', () => {
    expect(langFromBlockId('config/settings.json#0')).toBe('json')
  })

  it('maps Dockerfile (no extension) to dockerfile', () => {
    expect(langFromBlockId('docker/Dockerfile#0')).toBe('dockerfile')
  })

  it('maps dockerfile (lowercase) to dockerfile', () => {
    expect(langFromBlockId('Dockerfile#0')).toBe('dockerfile')
  })

  it('returns undefined for unknown extension', () => {
    expect(langFromBlockId('src/foo.unknown#0')).toBeUndefined()
  })

  it('returns undefined for extensionless non-Dockerfile file', () => {
    expect(langFromBlockId('Makefile#0')).toBeUndefined()
  })

  it('handles nested paths correctly', () => {
    expect(langFromBlockId('a/b/c/d.yaml#2')).toBe('yaml')
  })
})

describe('highlightBlock', () => {
  it('returns empty string for empty code', () => {
    expect(highlightBlock('')).toBe('')
  })

  it('uses hljs.highlight when lang is known', () => {
    mockGetLanguage.mockReturnValue(true)
    const result = highlightBlock('const x = 1', 'typescript')
    expect(mockHighlight).toHaveBeenCalledWith('const x = 1', { language: 'typescript' })
    expect(result).toBe('<highlighted>')
  })

  it('falls back to highlightAuto when lang is unknown', () => {
    mockGetLanguage.mockReturnValue(false)
    const result = highlightBlock('const x = 1', 'unknownlang')
    expect(mockHighlightAuto).toHaveBeenCalled()
    expect(result).toBe('<auto>')
  })

  it('falls back to highlightAuto when no lang provided', () => {
    const result = highlightBlock('const x = 1')
    expect(mockHighlightAuto).toHaveBeenCalled()
    expect(result).toBe('<auto>')
  })

  it('returns escaped html when hljs throws', () => {
    mockHighlight.mockImplementation(() => {
      throw new Error('hljs error')
    })
    const result = highlightBlock('<div>', 'html')
    expect(result).toBe('&lt;div&gt;')
  })
})

describe('highlightLine', () => {
  it('returns escaped html for whitespace-only line', () => {
    expect(highlightLine('   ')).toBe('   ')
  })

  it('returns empty string for empty line', () => {
    expect(highlightLine('')).toBe('')
  })

  it('uses hljs.highlight when lang is known', () => {
    mockGetLanguage.mockReturnValue(true)
    const result = highlightLine('const x = 1', 'typescript')
    expect(mockHighlight).toHaveBeenCalledWith('const x = 1', { language: 'typescript' })
    expect(result).toBe('<highlighted>')
  })

  it('returns escaped html when no lang provided', () => {
    const result = highlightLine('const x = 1')
    expect(result).toBe('const x = 1')
  })

  it('returns escaped html when lang is unknown', () => {
    mockGetLanguage.mockReturnValue(false)
    const result = highlightLine('<tag>', 'unknownlang')
    expect(result).toBe('&lt;tag&gt;')
  })

  it('returns escaped html when hljs throws', () => {
    mockHighlight.mockImplementation(() => {
      throw new Error('hljs error')
    })
    const result = highlightLine('<div>', 'html')
    expect(result).toBe('&lt;div&gt;')
  })

  it('escapes html special characters in fallback path', () => {
    mockGetLanguage.mockReturnValue(false)
    const result = highlightLine('<>&"\'')
    expect(result).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
})
