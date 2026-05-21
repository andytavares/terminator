import { describe, it, expect } from 'vitest'
import { parseFile } from '../../src/vault/parser'

describe('parseFile', () => {
  it('parses open task marker [ ]', () => {
    const result = parseFile('- [ ] Buy groceries', '/vault/daily/2026-05-19.md')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].status).toBe('open')
    expect(result.tasks[0].text).toBe('Buy groceries')
  })

  it('parses done task marker [x]', () => {
    const result = parseFile('- [x] Buy groceries', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].status).toBe('done')
  })

  it('parses done task marker [X]', () => {
    const result = parseFile('- [X] Buy groceries', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].status).toBe('done')
  })

  it('parses migrated task marker [>]', () => {
    const result = parseFile('- [>] Buy groceries', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].status).toBe('migrated')
  })

  it('parses cancelled task marker [-]', () => {
    const result = parseFile('- [-] Buy groceries', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].status).toBe('cancelled')
  })

  it('parses in-progress task marker [/]', () => {
    const result = parseFile('- [/] Buy groceries', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].status).toBe('in-progress')
  })

  it('parses @project tag', () => {
    const result = parseFile('- [ ] Write report @terminator', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].project).toBe('terminator')
    expect(result.tasks[0].text).toBe('Write report')
  })

  it('parses +context tag', () => {
    const result = parseFile('- [ ] Call dentist +phone', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].context).toBe('phone')
  })

  it('parses #area tag', () => {
    const result = parseFile('- [ ] File taxes #finance', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].area).toBe('finance')
  })

  it('parses due:YYYY-MM-DD metadata', () => {
    const result = parseFile('- [ ] Submit report due:2026-06-01', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].dueDate).toBe('2026-06-01')
  })

  it('parses generic key:value metadata', () => {
    const result = parseFile('- [ ] Task priority:high', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].metadata['priority']).toBe('high')
  })

  it('parses event line o HH:MM text', () => {
    const result = parseFile('o 09:00 Team standup', '/vault/daily/2026-05-19.md')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].time).toBe('09:00')
    expect(result.events[0].text).toBe('Team standup')
  })

  it('parses event line o text (no time)', () => {
    const result = parseFile('o Lunch with Sarah', '/vault/daily/2026-05-19.md')
    expect(result.events[0].time).toBeUndefined()
    expect(result.events[0].text).toBe('Lunch with Sarah')
  })

  it('parses note line * text', () => {
    const result = parseFile('* Remember to call mom', '/vault/daily/2026-05-19.md')
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].text).toBe('Remember to call mom')
  })

  it('assigns correct line numbers to tasks', () => {
    const content = `- [ ] Task one
- [ ] Task two`
    const result = parseFile(content, '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].line).toBe(1)
    expect(result.tasks[1].line).toBe(2)
  })

  it('assigns task ID as filepath:line', () => {
    const result = parseFile('- [ ] Task one', '/vault/daily/2026-05-19.md')
    expect(result.tasks[0].id).toBe('/vault/daily/2026-05-19.md:1')
  })

  it('returns empty arrays for empty file', () => {
    const result = parseFile('', '/vault/daily/2026-05-19.md')
    expect(result.tasks).toHaveLength(0)
    expect(result.events).toHaveLength(0)
    expect(result.notes).toHaveLength(0)
  })

  it('does not throw on malformed frontmatter', () => {
    const content = `---
invalid: [unclosed
---
- [ ] Task`
    expect(() => parseFile(content, '/vault/projects/test.md')).not.toThrow()
  })

  it('parses YAML frontmatter fields', () => {
    const content = `---
type: project
status: active
area: work
---
- [ ] Next action`
    const result = parseFile(content, '/vault/projects/test.md')
    expect(result.frontmatter?.type).toBe('project')
    expect(result.frontmatter?.status).toBe('active')
    expect(result.frontmatter?.area).toBe('work')
  })

  it('parses multiple tags in one task', () => {
    const result = parseFile(
      '- [ ] Fix bug @terminator +computer #work due:2026-05-20',
      '/vault/daily/2026-05-19.md'
    )
    const task = result.tasks[0]
    expect(task.project).toBe('terminator')
    expect(task.context).toBe('computer')
    expect(task.area).toBe('work')
    expect(task.dueDate).toBe('2026-05-20')
    expect(task.text).toBe('Fix bug')
  })

  it('parses multiple tasks, events, and notes in one file', () => {
    const content = `- [ ] Task one
o 10:00 Meeting
* Important note
- [x] Done task`
    const result = parseFile(content, '/vault/daily/2026-05-19.md')
    expect(result.tasks).toHaveLength(2)
    expect(result.events).toHaveLength(1)
    expect(result.notes).toHaveLength(1)
  })
})
