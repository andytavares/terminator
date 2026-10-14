import { relative } from 'node:path'
import { watchTree, type TreeEventType, type TreeWatch } from './tree-watch.js'

/** What changed under one watched root since its listeners were last told. */
export interface FsChangeBatch {
  projectRoot: string
  /** `rename` when any file appeared or went. */
  eventType: TreeEventType
  /** Each path once, from the root; null stands for a change the platform did not name. */
  filenames: Array<string | null>
}

export type FsChangeListener = (batch: FsChangeBatch) => void

interface WatchTiming {
  /** How long a tree must be quiet before its listeners are told. */
  settleMs: number
  /** The longest a change waits while others keep arriving. */
  maxWaitMs: number
  /** How often a tree that cannot be watched is reported as changed. */
  pollMs: number
}

const DEFAULT_TIMING: WatchTiming = { settleMs: 100, maxWaitMs: 1000, pollMs: 3000 }

/** Gathers the changes of one burst (a checkout, an install) into one batch. */
class ChangeBurst {
  private filenames = new Set<string | null>()
  private renamed = false
  private quiet: NodeJS.Timeout | undefined
  private limit: NodeJS.Timeout | undefined

  constructor(
    private readonly timing: WatchTiming,
    private readonly deliver: (eventType: TreeEventType, filenames: Array<string | null>) => void
  ) {}

  include(eventType: TreeEventType, filename: string | null): void {
    this.filenames.add(filename)
    this.renamed ||= eventType === 'rename'
    clearTimeout(this.quiet)
    this.quiet = setTimeout(() => this.end(), this.timing.settleMs)
    this.limit ??= setTimeout(() => this.end(), this.timing.maxWaitMs)
  }

  /** Forgets what it gathered, telling nobody. */
  discard(): void {
    clearTimeout(this.quiet)
    clearTimeout(this.limit)
    this.limit = undefined
    this.filenames = new Set()
    this.renamed = false
  }

  private end(): void {
    const filenames = [...this.filenames]
    const eventType = this.renamed ? 'rename' : 'change'
    this.discard()
    this.deliver(eventType, filenames)
  }
}

/** One watched tree and everyone listening to it. */
class WatchedRoot {
  readonly listeners = new Set<FsChangeListener>()
  private readonly burst: ChangeBurst
  private stopWatching: () => void = () => undefined
  private poll: NodeJS.Timeout | undefined

  constructor(
    private readonly root: string,
    private readonly timing: WatchTiming,
    watch: TreeWatch
  ) {
    this.burst = new ChangeBurst(timing, (eventType, filenames) => this.tell(eventType, filenames))
    try {
      this.stopWatching = watch(root, {
        onChange: (eventType, path) =>
          this.burst.include(eventType, path === null ? null : relative(root, path)),
        onError: () => this.pollInstead(),
      })
    } catch {
      this.pollInstead()
    }
  }

  close(): void {
    this.stopWatching()
    this.burst.discard()
    clearInterval(this.poll)
  }

  /** A tree that cannot be watched is reported as changed on an interval (ADR 005). */
  private pollInstead(): void {
    this.stopWatching()
    this.poll ??= setInterval(() => this.tell('change', [null]), this.timing.pollMs)
  }

  private tell(eventType: TreeEventType, filenames: Array<string | null>): void {
    for (const listener of this.listeners) {
      try {
        listener({ projectRoot: this.root, eventType, filenames })
      } catch {
        // One listener failing must not cost the others the change.
      }
    }
  }
}

/** Every tree the app watches. A root is watched once however many listeners it has, and for as
 * long as it has one.
 * @internal */
export class FsWatcherService {
  private readonly roots = new Map<string, WatchedRoot>()

  constructor(
    private readonly timing: WatchTiming = DEFAULT_TIMING,
    private readonly openTree: TreeWatch = watchTree
  ) {}

  watch(root: string, listener: FsChangeListener): void {
    let watched = this.roots.get(root)
    if (!watched) {
      watched = new WatchedRoot(root, this.timing, this.openTree)
      this.roots.set(root, watched)
    }
    watched.listeners.add(listener)
  }

  /** Stops every watch `listener` has, and closes the trees left with no listener. */
  unwatch(listener: FsChangeListener): void {
    for (const [root, watched] of this.roots) {
      watched.listeners.delete(listener)
      if (watched.listeners.size > 0) continue
      watched.close()
      this.roots.delete(root)
    }
  }
}

export const fsWatcherService = new FsWatcherService()
