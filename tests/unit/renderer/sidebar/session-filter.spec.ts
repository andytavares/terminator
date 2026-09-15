import { describe, it, expect } from 'vitest'
import { matchesFilter } from '../../../../src/renderer/sidebar/session-filter'
import { fact } from './fixtures/facts'

const linked = fact({
  name: 'claude',
  workspaceName: 'Northwind',
  projectName: 'northwind-api',
  branch: 'nw-88-rate-limits',
  workItem: { source: 'session', ref: { tracker: 'linear', key: 'NW-88' } },
  description: 'Reproducing the staging 429s\nbefore the release',
})

const titles = new Map([['linear:NW-88', 'Rate limit per API key']])

describe('matchesFilter', () => {
  it('matches everything when the filter is empty or blank', () => {
    expect(matchesFilter(linked, '', titles)).toBe(true)
    expect(matchesFilter(linked, '   ', titles)).toBe(true)
  })

  it.each([
    ['session name', 'CLAUDE'],
    ['workspace', 'northwind'],
    ['project', 'northwind-api'],
    ['branch', 'rate-limits'],
    ['ticket key', 'nw-88'],
    ['ticket title', 'api key'],
    ['description, first line', 'staging 429'],
    ['description, a later line', 'before the release'],
  ])('matches on the %s, ignoring case', (_field, text) => {
    expect(matchesFilter(linked, text, titles)).toBe(true)
  })

  it('does not match text found nowhere', () => {
    expect(matchesFilter(linked, 'ghostty', titles)).toBe(false)
  })

  it('does not match a ticket title it has not been given', () => {
    expect(matchesFilter(linked, 'api key', new Map())).toBe(false)
  })

  it('tolerates a session with no location', () => {
    const bare = fact({ workspaceName: null, projectName: null, branch: null })
    expect(matchesFilter(bare, 'zsh', titles)).toBe(true)
    expect(matchesFilter(bare, 'terminator', titles)).toBe(false)
  })
})
