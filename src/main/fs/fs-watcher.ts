import { watch, type FSWatcher } from 'fs'

export interface FsChangeEvent {
  projectRoot: string
  eventType: 'change' | 'rename'
  filename: string | null
}

type ChangeHandler = (event: FsChangeEvent) => void

export class FsWatcherService {
  private watcher: FSWatcher | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private handlers = new Set<ChangeHandler>()
  private projectRoot: string | null = null

  constructor(private readonly intervalMs: number = 3000) {}

  watchStart(projectRoot: string): void {
    if (this.projectRoot === projectRoot && (this.watcher || this.pollInterval)) return
    this.stop()
    this.projectRoot = projectRoot
    this.attachWatcher(projectRoot)
  }

  watchStop(): void {
    this.stop()
  }

  addHandler(handler: ChangeHandler): void {
    this.handlers.add(handler)
  }

  removeHandler(handler: ChangeHandler): void {
    this.handlers.delete(handler)
    if (this.handlers.size === 0) this.stop()
  }

  private emit(event: FsChangeEvent): void {
    for (const h of this.handlers) {
      try {
        h(event)
      } catch {
        /* ignore handler errors */
      }
    }
  }

  private attachWatcher(root: string): void {
    try {
      this.watcher = watch(root, { recursive: true }, (eventType, filename) => {
        this.emit({
          projectRoot: root,
          eventType: eventType === 'rename' ? 'rename' : 'change',
          filename: filename ?? null,
        })
      })
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
        this.startPolling(root)
      })
    } catch {
      this.startPolling(root)
    }
  }

  private startPolling(root: string): void {
    this.pollInterval = setInterval(() => {
      this.emit({ projectRoot: root, eventType: 'change', filename: null })
    }, this.intervalMs)
  }

  private stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.projectRoot = null
  }
}

export const fsWatcherService = new FsWatcherService()
