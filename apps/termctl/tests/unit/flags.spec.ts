import { describe, it, expect } from 'vitest'
import { parseToolArguments } from '../../src/flags'
import { UsageError } from '../../src/exit-codes'

const listProjects = {
  type: 'object',
  properties: { workspaceId: { type: 'string' } },
  required: ['workspaceId'],
}

describe('parseToolArguments: flag forms', () => {
  it('reads a camelCase property from its kebab-case flag', () => {
    expect(parseToolArguments(listProjects, ['--workspace-id', 'w1'])).toEqual({
      workspaceId: 'w1',
    })
  })

  it('reads a flag written with an equals sign', () => {
    expect(parseToolArguments(listProjects, ['--workspace-id=w1'])).toEqual({ workspaceId: 'w1' })
  })

  it('treats a boolean as a switch, and a missing required switch as false', () => {
    const schema = {
      type: 'object',
      properties: { isNewBranch: { type: 'boolean' }, refresh: { type: 'boolean' } },
      required: ['isNewBranch'],
    }
    expect(parseToolArguments(schema, ['--refresh'])).toEqual({ isNewBranch: false, refresh: true })
  })
})

describe('parseToolArguments: lists, objects and numbers', () => {
  it('collects a repeated array flag, with numbers parsed for a number array', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        pids: { type: 'array', items: { type: 'integer' } },
      },
    }
    expect(parseToolArguments(schema, ['--tags', 'a', '--pids', '12', '--tags', 'b'])).toEqual({
      tags: ['a', 'b'],
      pids: [12],
    })
  })

  it('reads an object flag as JSON', () => {
    const schema = { type: 'object', properties: { patch: { type: 'object' } } }
    expect(parseToolArguments(schema, ['--patch', '{"theme":"dark"}'])).toEqual({
      patch: { theme: 'dark' },
    })
  })

  it('parses a number flag', () => {
    const schema = { type: 'object', properties: { limit: { type: 'integer' } } }
    expect(parseToolArguments(schema, ['--limit', '5'])).toEqual({ limit: 5 })
  })
})

describe('parseToolArguments: null', () => {
  it('reads "null" as null for a property that may be null, and any other text as the string', () => {
    const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
    const schema = { type: 'object', properties: { branch: nullableString, date: nullableString } }
    expect(parseToolArguments(schema, ['--branch', '123', '--date', 'null'])).toEqual({
      branch: '123',
      date: null,
    })
  })
})

describe('parseToolArguments: untyped properties', () => {
  it('reads a property with no type as JSON, or as text when it is not JSON', () => {
    const schema = { type: 'object', properties: { value: {}, optionId: {} } }
    expect(parseToolArguments(schema, ['--value', '{"a":1}', '--option-id', 'yes'])).toEqual({
      value: { a: 1 },
      optionId: 'yes',
    })
  })

  it.each([
    [[], 'Missing required flag --workspace-id'],
    [['--workspace-id'], 'Flag --workspace-id needs a value'],
    [['--workspace-id', 'w1', '--colour', 'red'], 'Unknown flag --colour'],
    [['--workspace-id', 'w1', 'extra'], 'Unexpected argument extra'],
  ])('refuses %j with a usage error', (args, message) => {
    expect(() => parseToolArguments(listProjects, args)).toThrow(new UsageError(message))
  })

  it.each([
    [{ limit: { type: 'number' } }, ['--limit', 'five'], 'Flag --limit needs a number, not five'],
    [{ patch: { type: 'object' } }, ['--patch', '{theme'], 'Flag --patch needs JSON, not {theme'],
  ])('refuses a value that does not parse: %j', (properties, args, message) => {
    expect(() => parseToolArguments({ type: 'object', properties }, args)).toThrow(
      new UsageError(message)
    )
  })
})
