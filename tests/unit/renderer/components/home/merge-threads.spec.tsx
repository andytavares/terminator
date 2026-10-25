import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeTempDir } from '../../../../support/temp-dir'
import { wireMainTaskStore } from '../../../../support/main-task-store'
import {
  canMergeThreads,
  mergeThreads,
  undoMerge,
} from '../../../../../src/renderer/components/home/task-actions'
import type { WorkThread } from '../../../../../src/renderer/home/work-threads'
import type { TaskLane } from '../../../../../src/shared/schemas/tasks.schema'

let userData: string
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const api = { repoRoot: '/code/api', branch: 'rate-limits' }
const web = { repoRoot: '/code/web', branch: 'rate-limits' }
const infra = { repoRoot: '/code/infra', branch: 'quotas' }

let main: Awaited<ReturnType<typeof wireMainTaskStore>>

const threadOf = (key: string, lanes: TaskLane[], taskId: string | null = null): WorkThread =>
  ({ key, title: key, taskId, focus: false, lanes }) as unknown as WorkThread

const stored = () => main.listTasks().map((t) => ({ title: t.title, lanes: t.lanes }))

beforeEach(async () => {
  userData = makeTempDir('merge-threads-')
  main = await wireMainTaskStore()
})

describe('mergeThreads — dropping one Home row onto another', () => {
  it('moves a stored task’s lanes into the task it was dropped on, leaving one task', async () => {
    const into = await main.createTask({ title: 'Rate limits', lanes: [api] })
    const from = await main.createTask({ title: 'Web side', lanes: [web] })
    const merged = await mergeThreads(
      threadOf('task:web', [web], from.id),
      threadOf('task:rate', [api], into.id)
    )
    expect(merged).not.toBeNull()
    expect(stored()).toEqual([{ title: 'Rate limits', lanes: [api, web] }])
  })
})

describe('mergeThreads — Undo', () => {
  it('puts a merged task back on Undo, with its own title and lanes', async () => {
    const into = await main.createTask({ title: 'Rate limits', lanes: [api] })
    const from = await main.createTask({ title: 'Web side', lanes: [web] })
    const undo = await mergeThreads(
      threadOf('task:web', [web], from.id),
      threadOf('task:rate', [api], into.id)
    )
    await undoMerge(undo!)
    expect(stored()).toEqual([
      { title: 'Rate limits', lanes: [api] },
      { title: 'Web side', lanes: [web] },
    ])
  })

  it('takes added branches back out on Undo', async () => {
    const into = await main.createTask({ title: 'Rate limits', lanes: [api] })
    const undo = await mergeThreads(
      threadOf('/code/infra#quotas', [infra]),
      threadOf('t', [api], into.id)
    )
    await undoMerge(undo!)
    expect(stored()).toEqual([{ title: 'Rate limits', lanes: [api] }])
  })

  it('adds a branch that is in no task to the task it was dropped on', async () => {
    const into = await main.createTask({ title: 'Rate limits', lanes: [api] })
    await mergeThreads(threadOf('/code/infra#quotas', [infra]), threadOf('task:r', [api], into.id))
    expect(stored()).toEqual([{ title: 'Rate limits', lanes: [api, infra] }])
  })
})

describe('mergeThreads — onto a row that is only a branch', () => {
  it('makes a task of the row dropped on when it is only a branch, named by that row', async () => {
    await mergeThreads(threadOf('/code/web#rate-limits', [web]), threadOf('Login rework', [api]))
    expect(stored()).toEqual([{ title: 'Login rework', lanes: [api, web] }])
  })
})

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
