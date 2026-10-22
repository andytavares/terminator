import { describe, it, expect } from 'vitest'
import { getConfig } from '@testing-library/dom'

// findBy* and waitFor give up after Testing Library's default of one second. A lazy view that
// took longer to import on a cold CI runner failed the git-integration App spec (run
// 39784273096); the wait is bounded only to catch a hang.
describe("Testing Library's wait", () => {
  it('gives up only after the 30-second bound, never after one second', () => {
    expect(getConfig().asyncUtilTimeout).toBe(30_000)
  })
})
