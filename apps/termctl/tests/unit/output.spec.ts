import { describe, it, expect } from 'vitest'
import { formatResult } from '../../src/output'

describe('formatResult: tables', () => {
  it('prints an array of objects as a table of their top-level scalar fields', () => {
    const tasks = [
      { id: 't1', title: 'Ship termctl', done: false, lanes: [{ kind: 'session' }] },
      { id: 't22', title: 'Docs', done: true, ticket: null, lanes: [] },
    ]
    expect(formatResult(JSON.stringify(tasks), { json: false })).toBe(
      [
        'id   title         done   ticket',
        't1   Ship termctl  false',
        't22  Docs          true',
        '',
      ].join('\n')
    )
  })

  it('prints the rows of an object whose only field is an array of objects as a table', () => {
    const result = { workspaces: [{ id: 'w1', name: 'terminator', tags: [] }] }
    expect(formatResult(JSON.stringify(result), { json: false })).toBe('id  name\nw1  terminator\n')
  })
})

describe('formatResult: other results', () => {
  it('prints any other result as indented JSON', () => {
    expect(formatResult('{"version":"1.2.3"}', { json: false })).toBe(
      '{\n  "version": "1.2.3"\n}\n'
    )
  })

  it('prints the raw result with --json', () => {
    expect(formatResult('[{"id":"t1"}]', { json: true })).toBe('[{"id":"t1"}]\n')
  })

  it('prints a result that is not JSON as it is', () => {
    expect(formatResult('Window shown', { json: false })).toBe('Window shown\n')
  })
})
