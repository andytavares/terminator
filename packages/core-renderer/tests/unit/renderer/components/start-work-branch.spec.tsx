import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { askBranchName, NAMING_WAIT_MS } from '../../../../src/components/home/start-work'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'

const get = vi.fn<ElectronAPI['homeBranchName']['get']>()

beforeEach(() => {
  vi.useFakeTimers()
  installElectronApi({ homeBranchName: { get } })
})
afterEach(() => vi.useRealTimers())

describe('askBranchName', () => {
  it('answers the agent name', async () => {
    get.mockResolvedValue({ text: 'feat/dark-mode\n' })
    expect(await askBranchName('add dark mode')).toBe('feat/dark-mode')
  })

  it('answers null when the agent is still silent after 5 seconds', async () => {
    get.mockReturnValue(new Promise(() => {}))
    const answer = askBranchName('add dark mode')
    await vi.advanceTimersByTimeAsync(NAMING_WAIT_MS - 1)
    expect(await Promise.race([answer, Promise.resolve('pending')])).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(await answer).toBeNull()
  })

  it('answers null on a failure and on an error reply', async () => {
    get.mockRejectedValueOnce(new Error('gone'))
    expect(await askBranchName('x')).toBeNull()
    get.mockResolvedValueOnce({ error: 'TIMEOUT' })
    expect(await askBranchName('x')).toBeNull()
  })
})
