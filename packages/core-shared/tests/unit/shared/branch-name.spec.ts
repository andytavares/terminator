import { describe, it, expect } from 'vitest'
import { promptBranch, semanticBranch } from '../../../src/home/branch-name'

describe('semanticBranch', () => {
  it.each([
    ['feat/retry-uploads', 'feat/retry-uploads'],
    ['  `fix/Login Crash`\nbecause it crashes', 'fix/login-crash'],
    ['"feat/add-dark-mode."', 'feat/add-dark-mode'],
  ])('accepts %j as %j', (text, name) => {
    expect(semanticBranch(text)).toBe(name)
  })

  it.each(['', 'retry uploads', 'chore/tidy-up', 'feat/', 'feat/' + 'a'.repeat(60)])(
    'rejects %j',
    (text) => {
      expect(semanticBranch(text)).toBeNull()
    }
  )
})

describe('promptBranch', () => {
  it('uses the first four words in kebab case', () => {
    expect(promptBranch('Fix the flaky   Login test, please!')).toBe('prompt/fix-the-flaky-login')
  })

  it('keeps a short prompt whole', () => {
    expect(promptBranch('Tidy up')).toBe('prompt/tidy-up')
  })

  it('has a name for a prompt with no words', () => {
    expect(promptBranch('!!!')).toBe('prompt/work')
  })
})
