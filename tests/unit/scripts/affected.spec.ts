import { describe, expect, it } from 'vitest'
import { reaches, turboCommand } from '../../../scripts/affected.mjs'

describe('whether a change reaches a package', () => {
  it('reaches a package that turbo names as affected', () => {
    expect(
      reaches('@terminator/extension-ui', ['@terminator/core-shared', '@terminator/extension-ui'])
    ).toBe(true)
  })

  it('does not reach a package turbo leaves out', () => {
    expect(reaches('@terminator/extension-ui', ['@terminator/extension-notepad'])).toBe(false)
  })
})

describe('the turbo the scripts run before npm ci', () => {
  it('is the exact version package.json pins, so npx runs that one', () => {
    expect(turboCommand({ devDependencies: { turbo: '2.11.10' } })).toEqual([
      '--yes',
      'turbo@2.11.10',
      'query',
      'affected',
      '--packages',
    ])
  })
})
