import { describe, it, expect } from 'vitest'
import { parseFile } from '../../src/vault/parser'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('terminator link parsing', () => {
  it('parses terminator:<uuid> from task text into terminatorLinks[]', () => {
    const result = parseFile(`- [ ] Fix bug terminator:${UUID}`, '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].terminatorLinks).toContain(UUID)
  })

  it('parses multiple UUIDs from task text', () => {
    const uuid2 = '123e4567-e89b-12d3-a456-426614174000'
    const result = parseFile(
      `- [ ] Task terminator:${UUID} terminator:${uuid2}`,
      '/vault/daily/2026-05-19.md'
    )
    expect(result.tasks[0].terminatorLinks).toHaveLength(2)
  })

  it('ignores non-UUID terminator: references gracefully', () => {
    expect(() =>
      parseFile('- [ ] Task terminator:notauuid', '/vault/daily/2026-05-19.md')
    ).not.toThrow()
    const result = parseFile('- [ ] Task terminator:notauuid', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].terminatorLinks).toHaveLength(0)
  })

  it('strips terminator tags from task text', () => {
    const result = parseFile(`- [ ] Fix bug terminator:${UUID}`, '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].text).not.toContain('terminator:')
  })
})
