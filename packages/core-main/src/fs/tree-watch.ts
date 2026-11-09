import { readdirSync, watch, type FSWatcher } from 'node:fs'
import { join, sep } from 'node:path'

// Watching a directory and everything under it (ADR 109). Linux gets one watch per directory:
// Node's own `recursive` there watches each file by path, and reports a file replaced by a rename,
// which is how git writes its index, the first time only.

export type TreeEventType = 'change' | 'rename'

/** @internal */
export interface TreeWatchHandlers {
  /** `path` is absolute, or null when the platform did not name what changed. */
  onChange: (eventType: TreeEventType, path: string | null) => void
  /** The watch has failed and reports nothing more. */
  onError: (error: unknown) => void
}

/** Starts watching `root`; throws when it cannot. Returns the way to stop. */
export type TreeWatch = (root: string, handlers: TreeWatchHandlers) => () => void

/** True inside `node_modules` and git's object store: no status depends on them, and on Linux
 * each of their directories would cost a watch.
 * @internal */
export function isUnwatchedPath(path: string): boolean {
  const segments = path.split(sep)
  return (
    segments.includes('node_modules') ||
    segments.some((segment, index) => segment === '.git' && segments[index + 1] === 'objects')
  )
}

function typeOf(eventType: string): TreeEventType {
  return eventType === 'rename' ? 'rename' : 'change'
}

/** The platform's own recursive watch.
 * @internal */
export const watchNativeRecursive: TreeWatch = (root, handlers) => {
  const watcher = watch(root, { recursive: true }, (eventType, name) => {
    const path = name === null ? null : join(root, name)
    if (path !== null && isUnwatchedPath(path)) return
    handlers.onChange(typeOf(eventType), path)
  })
  watcher.on('error', handlers.onError)
  return () => watcher.close()
}

/** The directories directly inside `directory`, or null when it is not a directory. A link to a
 * directory is not followed. */
function subdirectoriesOf(directory: string): string[] | null {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name))
  } catch {
    return null
  }
}

class DirectoryTreeWatch {
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(private readonly handlers: TreeWatchHandlers) {}

  /** Watches `directory` and the directories under it; does nothing for a file. */
  watchDirectory(directory: string): void {
    if (isUnwatchedPath(directory) || this.watchers.has(directory)) return
    const children = subdirectoriesOf(directory)
    if (children === null) return
    const watcher = watch(directory, (eventType, name) =>
      this.reportEntry(directory, eventType, name)
    )
    watcher.on('error', () => this.closeUnder(directory))
    this.watchers.set(directory, watcher)
    for (const child of children) this.watchDirectory(child)
  }

  /** Closes the watch on `directory` and on every directory under it. */
  closeUnder(directory: string): void {
    for (const [path, watcher] of this.watchers) {
      if (path !== directory && !path.startsWith(directory + sep)) continue
      watcher.close()
      this.watchers.delete(path)
    }
  }

  private reportEntry(directory: string, eventType: string, name: string | null): void {
    const path = name === null ? null : join(directory, name)
    if (path !== null && isUnwatchedPath(path)) return
    if (path !== null && eventType === 'rename') this.watchAgain(path)
    this.handlers.onChange(typeOf(eventType), path)
  }

  /** An entry that appeared or went: a directory under that name is a new one, whose old watch
   * (if it had one) is on a directory that no longer exists. */
  private watchAgain(path: string): void {
    this.closeUnder(path)
    try {
      this.watchDirectory(path)
    } catch (error) {
      this.handlers.onError(error)
    }
  }
}

/** One watch per directory, opened for each directory as it appears.
 * @internal */
export const watchDirectoryTree: TreeWatch = (root, handlers) => {
  if (subdirectoriesOf(root) === null) throw new Error(`not a directory: ${root}`)
  const tree = new DirectoryTreeWatch(handlers)
  try {
    tree.watchDirectory(root)
  } catch (error) {
    tree.closeUnder(root)
    throw error
  }
  return () => tree.closeUnder(root)
}

/** How this platform watches a tree. */
export const watchTree: TreeWatch =
  process.platform === 'linux' ? watchDirectoryTree : watchNativeRecursive
