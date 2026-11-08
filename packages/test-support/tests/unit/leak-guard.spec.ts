import { describe, it, expect } from 'vitest'
import { createLeakGuard } from '../../src/leak-guard'

describe('the leak guard packages/test-support/setup.ts runs after every test', () => {
  describe('intervals', intervalTests)
  describe('handles', handleTests)
})

function intervalTests() {
  it('names an interval a test left running, and the line that started it', async () => {
    const guard = createLeakGuard()
    guard.begin()
    const interval = setInterval(() => {}, 1000)
    try {
      await expect(guard.check()).rejects.toThrow(
        /left a Timeout running, created at .*leak-guard\.spec/
      )
    } finally {
      clearInterval(interval)
    }
  })

  it('passes once the interval is cleared', async () => {
    const guard = createLeakGuard()
    guard.begin()
    clearInterval(setInterval(() => {}, 1000))
    await expect(guard.check()).resolves.toBeUndefined()
  })
}

function handleTests() {
  it('ignores a resource made before the test began, and one that does not hold the process', async () => {
    const before = setInterval(() => {}, 1000)
    const guard = createLeakGuard()
    guard.begin()
    setInterval(() => {}, 1000).unref()
    try {
      await expect(guard.check()).resolves.toBeUndefined()
    } finally {
      clearInterval(before)
    }
  })
}
