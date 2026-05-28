import { describe, it, expect } from 'vitest'
import { extractTags } from '../../src/vault/tags'

describe('extractTags', () => {
  it('returns empty fields for plain text', () => {
    const result = extractTags('Buy groceries')
    expect(result.text).toBe('Buy groceries')
    expect(result.project).toBeUndefined()
    expect(result.context).toBeUndefined()
    expect(result.area).toBeUndefined()
    expect(result.dueDate).toBeUndefined()
    expect(result.terminatorLinks).toEqual([])
    expect(result.metadata).toEqual({})
  })

  it('extracts @project tag and removes it from text', () => {
    const result = extractTags('Fix bug @my-project')
    expect(result.project).toBe('My Project')
    expect(result.text).not.toContain('@my-project')
    expect(result.text.trim()).toBe('Fix bug')
  })

  it('extracts +context tag and removes it from text', () => {
    const result = extractTags('Call client +phone')
    expect(result.context).toBe('Phone')
    expect(result.text).not.toContain('+phone')
  })

  it('extracts #area tag and removes it from text', () => {
    const result = extractTags('Write report #work')
    expect(result.area).toBe('Work')
    expect(result.text).not.toContain('#work')
  })

  it('extracts due: metadata and sets dueDate', () => {
    // Lines 52-59: the while loop for TAG_META — key==='due' branch
    const result = extractTags('Task due:2026-06-01')
    expect(result.dueDate).toBe('2026-06-01')
    expect(result.text).not.toContain('due:')
  })

  it('extracts non-due metadata into metadata map (else branch in TAG_META loop)', () => {
    // Lines 52-59: key !== 'due' && key !== 'terminator' branch
    const result = extractTags('Do thing priority:high')
    expect(result.metadata['priority']).toBe('high')
    expect(result.dueDate).toBeUndefined()
  })

  it('extracts terminator:<uuid> links and lowercases them (lines 29-31)', () => {
    // Lines 29-31: the while loop body — terminatorLinks.push
    const uuid = '550E8400-E29B-41D4-A716-446655440000'
    const result = extractTags(`Link terminator:${uuid}`)
    expect(result.terminatorLinks).toHaveLength(1)
    expect(result.terminatorLinks[0]).toBe(uuid.toLowerCase())
  })

  it('extracts multiple terminator links', () => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000'
    const uuid2 = '660e8400-e29b-41d4-a716-446655440001'
    const result = extractTags(`Do task terminator:${uuid1} also terminator:${uuid2}`)
    expect(result.terminatorLinks).toHaveLength(2)
    expect(result.terminatorLinks).toContain(uuid1)
    expect(result.terminatorLinks).toContain(uuid2)
  })

  it('ignores terminator: key in metadata map (key === terminator branch in else-if)', () => {
    // Lines 54-58: key === 'due' → dueDate, else if key !== 'terminator' → metadata
    // When key IS 'terminator', it should NOT appear in metadata
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const result = extractTags(`Task terminator:${uuid}`)
    expect(result.metadata['terminator']).toBeUndefined()
  })

  it('handles all tag types together and strips them from text', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const raw = `Review report @my-project +office #work due:2026-07-01 priority:low terminator:${uuid}`
    const result = extractTags(raw)
    expect(result.project).toBe('My Project')
    expect(result.context).toBe('Office')
    expect(result.area).toBe('Work')
    expect(result.dueDate).toBe('2026-07-01')
    expect(result.metadata['priority']).toBe('low')
    expect(result.terminatorLinks).toContain(uuid)
    expect(result.text.trim()).toBe('Review report')
  })

  it('only takes first @project occurrence', () => {
    const result = extractTags('Task @proj-one @proj-two')
    expect(result.project).toBe('Proj One')
    expect(result.project).not.toBe('Proj Two')
  })

  it('only takes first +context occurrence', () => {
    const result = extractTags('Task +ctx-a +ctx-b')
    expect(result.context).toBe('Ctx A')
  })

  it('only takes first #area occurrence', () => {
    const result = extractTags('Task #area-one #area-two')
    expect(result.area).toBe('Area One')
  })

  it('handles raw text with no tags, returns clean text', () => {
    const result = extractTags('   Just a plain task   ')
    expect(result.text).toBe('Just a plain task')
    expect(result.terminatorLinks).toEqual([])
    expect(result.metadata).toEqual({})
  })

  it('returns empty terminatorLinks when no terminator links present (loop not entered)', () => {
    // This exercises the case where the while loop at lines 29-31 is never entered
    const result = extractTags('No links here at all')
    expect(result.terminatorLinks).toHaveLength(0)
  })

  it('returns empty metadata when no key:value pairs present', () => {
    // Lines 51-59: while loop not entered when no meta patterns
    const result = extractTags('Simple task @project')
    expect(result.metadata).toEqual({})
  })
})
