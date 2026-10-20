// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  DISMISSED_THREADS_KEY,
  isDismissed,
  useDismissedThreads,
} from '../../../../src/renderer/components/home/dismissed-threads'
import { storedDismissedOf } from '../../../../src/renderer/home/stored-shapes'

const storedDismissed = (): unknown =>
  JSON.parse(localStorage.getItem(DISMISSED_THREADS_KEY) ?? '{}')

describe('useDismissedThreads', () => {
  beforeEach(() => {
    localStorage.clear()
    useDismissedThreads.setState({ dismissed: {} })
  })

  it('dismisses a thread at the time given and restores it', () => {
    useDismissedThreads.getState().dismiss('linear:TAV-20', 100)
    expect(useDismissedThreads.getState().dismissed).toEqual({ 'linear:TAV-20': 100 })
    expect(storedDismissed()).toEqual({ 'linear:TAV-20': 100 })
    useDismissedThreads.getState().restore('linear:TAV-20')
    expect(useDismissedThreads.getState().dismissed).toEqual({})
    expect(localStorage.getItem(DISMISSED_THREADS_KEY)).toBe('{}')
  })

  it('a dismissed thread stays dismissed whatever its activity does afterwards', () => {
    useDismissedThreads.getState().dismiss('session:scratch', 100)
    const dismissed = useDismissedThreads.getState().dismissed
    expect(isDismissed(dismissed, 'session:scratch')).toBe(true)
    expect(isDismissed(dismissed, 'session:other')).toBe(false)
  })

  it('a restored thread is no longer dismissed', () => {
    useDismissedThreads.getState().dismiss('session:scratch', 100)
    useDismissedThreads.getState().restore('session:scratch')
    expect(isDismissed(useDismissedThreads.getState().dismissed, 'session:scratch')).toBe(false)
  })
})

describe('useDismissedThreads — forgetting', () => {
  beforeEach(() => {
    localStorage.clear()
    useDismissedThreads.setState({ dismissed: {} })
  })

  it('forgets entries whose thread is gone once their dismissal is 30 days old', () => {
    const now = 100 * 24 * 60 * 60 * 1000
    useDismissedThreads.getState().dismiss('gone-old', now - 31 * 24 * 60 * 60 * 1000)
    useDismissedThreads.getState().dismiss('gone-new', now - 24 * 60 * 60 * 1000)
    useDismissedThreads.getState().forgetGone(new Set(['gone-new']), now)
    expect(useDismissedThreads.getState().dismissed).toEqual({
      'gone-new': now - 24 * 60 * 60 * 1000,
    })
  })
})

describe('storedDismissedOf', () => {
  it('reads thread keys with the activity each was dismissed at', () => {
    expect(storedDismissedOf({ 'linear:TAV-20': 42 })).toEqual({ 'linear:TAV-20': 42 })
  })

  it.each([
    ['a list', ['linear:TAV-20']],
    ['a time that is not a number', { k: 'later' }],
    ['nothing', null],
  ])('refuses %s', (_name, value) => {
    expect(storedDismissedOf(value)).toBeNull()
  })
})
