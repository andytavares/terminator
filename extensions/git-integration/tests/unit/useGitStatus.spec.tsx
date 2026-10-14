import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useGitStore } from '../../src/stores/git.store'
import { useGitStatus } from '../../src/hooks/useGitStatus'
import type { GitStatus } from '../../src/schemas/git.schema'

const CLEAN: GitStatus = { branch: 'main', files: [], hasConflicts: false, truncated: false }
/** A status on `branch`, which is how a spec tells one read's answer from another's. */
const statusOn = (branch: string): GitStatus => ({ ...CLEAN, branch })
type Answer = object | (() => Promise<unknown>)

/** The desktop as the hook reaches it: the roots being watched, everything it was asked, in
 * order, and the way to report a change in a watched root. */
class FakeDesktop {
  readonly watched = new Set<string>()
  readonly asked: string[] = []
  readonly answers: Record<string, Answer> = {
    'git:status': CLEAN,
    'git:watch-roots': { roots: ['/repo'] },
    watchStart: { ok: true },
  }
  private readonly changeHandlers = new Set<() => void>()

  readonly electronAPI = {
    extensionBridge: {
      invoke: (channel: string, payload: { path?: string; repoRoot?: string }) => {
        this.asked.push(`${channel} ${payload.path ?? payload.repoRoot}`)
        return this.answer(channel)
      },
    },
    fs: {
      watchStart: (root: string) => this.startWatch(root),
      watchStop: async () => (this.watched.clear(), { ok: true }),
      onChanged: (handler: () => void) => {
        this.changeHandlers.add(handler)
        return () => this.changeHandlers.delete(handler)
      },
    },
  }

  statusReads(): number {
    return this.asked.filter((entry) => entry.startsWith('git:status')).length
  }

  reportChange(): void {
    this.changeHandlers.forEach((handler) => handler())
  }

  private answer(name: string): Promise<unknown> {
    const value = this.answers[name]
    return typeof value === 'function' ? value() : Promise.resolve(value)
  }

  private async startWatch(root: string): Promise<unknown> {
    const started = (await this.answer('watchStart')) as { ok?: true }
    if (started.ok) this.watched.add(root)
    this.asked.push(`watch ${root}`)
    return started
  }
}

let desktop: FakeDesktop

/** Lets every promise the hook is waiting on settle. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0))

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  desktop = new FakeDesktop()
  Object.assign(globalThis, { electronAPI: desktop.electronAPI })
  useGitStore.setState({ status: null, disabled: false, isLoading: false })
})

afterEach(() => {
  // Unmounted while the desktop is still there: leaving a repository stops its watches.
  cleanup()
  setVisibility('visible')
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

describe('useGitStatus — starting', () => {
  it('shows no status for no repository, and watches nothing', async () => {
    useGitStore.setState({ status: CLEAN })
    renderHook(() => useGitStatus(null))
    await settle()
    expect(useGitStore.getState().status).toBeNull()
    expect(desktop.asked).toEqual([])
  })

  it('starts the watch before it reads status, so no change falls between them', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    expect(desktop.asked).toEqual(['git:watch-roots /repo', 'watch /repo', 'git:status /repo'])
    expect(useGitStore.getState().status).toEqual(CLEAN)
  })

  it('is loading until the first status has been read', async () => {
    renderHook(() => useGitStatus('/repo'))
    expect(useGitStore.getState().isLoading).toBe(true)
    await settle()
    expect(useGitStore.getState().isLoading).toBe(false)
  })
})

describe('useGitStatus — what it watches', () => {
  it('also watches the git directory of a linked worktree', async () => {
    desktop.answers['git:watch-roots'] = { roots: ['/worktree', '/repo/.git'] }
    renderHook(() => useGitStatus('/worktree'))
    await settle()
    expect([...desktop.watched]).toEqual(['/worktree', '/repo/.git'])
  })

  it.each([
    ['answers with an error', { error: 'Command failed' }],
    ['cannot be reached', () => Promise.reject(new Error('no handler'))],
  ])('watches the folder itself when the git directory %s', async (_how, answer) => {
    desktop.answers['git:watch-roots'] = answer
    renderHook(() => useGitStatus('/repo'))
    await settle()
    expect([...desktop.watched]).toEqual(['/repo'])
    expect(desktop.statusReads()).toBe(1)
  })
})

describe('useGitStatus — what a read shows', () => {
  it('shows no status when the read answers with an error', async () => {
    useGitStore.setState({ status: CLEAN })
    desktop.answers['git:status'] = { error: 'Not a git repo' }
    renderHook(() => useGitStatus('/repo'))
    await settle()
    expect(useGitStore.getState()).toMatchObject({ status: null, disabled: false })
  })

  it('says the workspace switched the extension off', async () => {
    desktop.answers['git:status'] = { error: 'GIT_DISABLED' }
    renderHook(() => useGitStatus('/repo'))
    await settle()
    expect(useGitStore.getState().disabled).toBe(true)
  })

  it('shows no status, and stops loading, when the read fails', async () => {
    useGitStore.setState({ status: CLEAN })
    desktop.answers['git:status'] = () => Promise.reject(new Error('bridge closed'))
    renderHook(() => useGitStatus('/repo'))
    await settle()
    expect(useGitStore.getState()).toMatchObject({ status: null, isLoading: false })
  })
})

describe('useGitStatus — a reported change', () => {
  it('reads status once for one change, and shows what it read', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    desktop.answers['git:status'] = statusOn('after-the-change')
    desktop.reportChange()
    await settle()
    expect(desktop.statusReads()).toBe(2)
    expect(useGitStore.getState().status).toEqual(statusOn('after-the-change'))
  })

  it('reads nothing more however long the tree stays unchanged', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(desktop.statusReads()).toBe(1)
  })
})

describe('useGitStatus — a change during a read', () => {
  it('reads once more after a read that changes arrived during, however many arrived', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    let finishRead: (status: unknown) => void = () => undefined
    desktop.answers['git:status'] = () => new Promise((resolve) => (finishRead = resolve))
    desktop.reportChange()
    await settle()
    desktop.reportChange()
    desktop.reportChange()
    desktop.answers['git:status'] = statusOn('changed-during-the-read')
    finishRead(CLEAN)
    await settle()
    expect(desktop.statusReads()).toBe(3)
    expect(useGitStore.getState().status).toEqual(statusOn('changed-during-the-read'))
  })
})

describe('useGitStatus — a hidden view', () => {
  it('reads nothing while hidden, and once when it is shown again', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    setVisibility('hidden')
    desktop.reportChange()
    desktop.reportChange()
    await settle()
    expect(desktop.statusReads()).toBe(1)
    setVisibility('visible')
    await settle()
    expect(desktop.statusReads()).toBe(2)
  })
})

describe('useGitStatus — where there is no watch (the remote browser client)', () => {
  beforeEach(() => {
    desktop.answers.watchStart = { error: 'WATCH_UNAVAILABLE' }
  })

  it('reads status every three seconds instead', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(desktop.statusReads()).toBe(4)
  })

  it('reads nothing while hidden', async () => {
    renderHook(() => useGitStatus('/repo'))
    await settle()
    setVisibility('hidden')
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(desktop.statusReads()).toBe(1)
  })

  it('stops when the view goes away', async () => {
    const { unmount } = renderHook(() => useGitStatus('/repo'))
    await settle()
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(desktop.statusReads()).toBe(1)
  })
})

describe('useGitStatus — leaving a repository', () => {
  it('stops its watches and reads nothing more when the view goes away', async () => {
    const { unmount } = renderHook(() => useGitStatus('/repo'))
    await settle()
    unmount()
    desktop.reportChange()
    setVisibility('visible')
    await settle()
    expect([...desktop.watched]).toEqual([])
    expect(desktop.statusReads()).toBe(1)
  })

  it('watches the new repository alone when the repository changes', async () => {
    const { rerender } = renderHook(({ root }) => useGitStatus(root), {
      initialProps: { root: '/repo' },
    })
    await settle()
    desktop.answers['git:watch-roots'] = { roots: ['/other'] }
    rerender({ root: '/other' })
    await settle()
    expect([...desktop.watched]).toEqual(['/other'])
    expect(desktop.asked.at(-1)).toBe('git:status /other')
  })
})

describe('useGitStatus — leaving before the watch started', () => {
  it('starts no watch for a repository left before its git directory was known', async () => {
    let nameRoots: (answer: unknown) => void = () => undefined
    desktop.answers['git:watch-roots'] = () => new Promise((resolve) => (nameRoots = resolve))
    const { unmount } = renderHook(() => useGitStatus('/repo'))
    unmount()
    nameRoots({ roots: ['/repo'] })
    await settle()
    expect([...desktop.watched]).toEqual([])
    expect(desktop.statusReads()).toBe(0)
  })
})
