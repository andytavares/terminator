import { describe, it, expect } from 'vitest'
import { claimProfile, type ProfileApp } from '../../../src/main/profile-lock'

function fakeApp(opts: { isPackaged: boolean; userDataSwitch?: boolean; lockFree?: boolean }) {
  const calls: string[] = []
  let userData = '/Users/me/Library/Application Support/@andytavares/terminator'
  const app: ProfileApp = {
    isPackaged: opts.isPackaged,
    commandLine: { hasSwitch: (name) => name === 'user-data-dir' && !!opts.userDataSwitch },
    getPath: () => userData,
    setPath: (_name, value) => {
      calls.push(`setPath:${value}`)
      userData = value
    },
    requestSingleInstanceLock: () => {
      calls.push(`lock:${userData}`)
      return opts.lockFree ?? true
    },
  }
  return { app, calls }
}

describe('claimProfile', () => {
  it('keeps the packaged app on the shared profile and locks it', () => {
    const { app, calls } = fakeApp({ isPackaged: true })
    expect(claimProfile(app)).toBe(true)
    expect(calls).toEqual(['lock:/Users/me/Library/Application Support/@andytavares/terminator'])
  })

  it('moves an unpackaged run to its own profile before taking the lock', () => {
    const { app, calls } = fakeApp({ isPackaged: false })
    claimProfile(app)
    expect(calls).toEqual([
      'setPath:/Users/me/Library/Application Support/@andytavares/terminator-dev',
      'lock:/Users/me/Library/Application Support/@andytavares/terminator-dev',
    ])
  })

  it('leaves an explicit --user-data-dir alone', () => {
    const { app, calls } = fakeApp({ isPackaged: false, userDataSwitch: true })
    claimProfile(app)
    expect(calls).toEqual(['lock:/Users/me/Library/Application Support/@andytavares/terminator'])
  })

  it('reports false when another process already owns the profile', () => {
    const { app } = fakeApp({ isPackaged: true, lockFree: false })
    expect(claimProfile(app)).toBe(false)
  })
})
