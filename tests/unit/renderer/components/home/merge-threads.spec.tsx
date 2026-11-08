import { describe, it, expect } from 'vitest'
import { canMergeThreads } from '../../../../../src/renderer/components/home/task-actions'
import type { WorkThread } from '../../../../../src/renderer/home/work-threads'
import type { TaskLane } from '../../../../../src/shared/schemas/tasks.schema'

const api = { repoRoot: '/code/api', branch: 'rate-limits' }
const web = { repoRoot: '/code/web', branch: 'rate-limits' }
const threadOf = (key: string, lanes: TaskLane[], taskId: string | null = null): WorkThread =>
  ({ key, title: key, taskId, focus: false, lanes }) as unknown as WorkThread

describe('canMergeThreads', () => {
  it('refuses a row onto itself, and a row with no branch either way', () => {
    const branch = threadOf('/code/api#rate-limits', [api])
    const scratch = threadOf('scratch', [])
    expect(canMergeThreads(branch, branch)).toBe(false)
    expect(canMergeThreads(scratch, branch)).toBe(false)
    expect(canMergeThreads(branch, scratch)).toBe(false)
    expect(canMergeThreads(threadOf('/code/web#rate-limits', [web]), branch)).toBe(true)
  })
})
