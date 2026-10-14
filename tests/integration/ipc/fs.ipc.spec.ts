import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WebContents } from 'electron'
import { makeTempDir } from '../../support/temp-dir'
import { partialFake } from '../../support/fakes'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

import { registerFsHandlers } from '../../../src/main/ipc/fs.ipc'

registerFsHandlers()

interface ChangeEvent {
  projectRoot: string
  eventType: string
  filename: string | null
}

/** A view as the handlers know one: what it was sent, and the ways it can go away. */
function fakeView() {
  const received: ChangeEvent[] = []
  let destroyed = false
  const events = new EventEmitter()
  type Listener = (...args: never[]) => void
  const calling = (listener: Listener) => (details: unknown) => listener(details as never)
  const sender: WebContents = partialFake<WebContents>({
    send: (_channel: string, event: ChangeEvent) => void received.push(event),
    isDestroyed: () => destroyed,
    once: (name: string, listener: Listener) => (events.once(name, calling(listener)), sender),
    on: (name: string, listener: Listener) => (events.on(name, calling(listener)), sender),
  })
  const destroy = () => {
    destroyed = true
    events.emit('destroyed')
  }
  const navigate = (navigation: { isMainFrame: boolean; isSameDocument: boolean }) =>
    events.emit('did-start-navigation', navigation)
  return { sender, received, destroy, navigate }
}

type View = ReturnType<typeof fakeView>

function invoke<T>(channel: string, view: View, payload?: unknown): Promise<T> {
  return Promise.resolve(handlers.get(channel)!({ sender: view.sender }, payload)) as Promise<T>
}

const startWatch = (view: View, projectRoot: string) =>
  invoke('fs:watch-start', view, { projectRoot })

/** Looks less often than a burst takes to settle, or each look's write would keep it open. */
const LOOKS = { interval: 250, timeout: 10_000 }

/** Writes the file again on each look: macOS arms a watch a moment after `fs.watch` returns, and a
 * change made before that has no event. Resolves once `view` has been told about `root`. */
async function changeUntilTold(root: string, view: View): Promise<void> {
  await vi.waitFor(() => {
    const told = view.received.some((event) => event.projectRoot === root)
    if (!told) fs.writeFileSync(path.join(root, 'a.ts'), String(Math.random()))
    expect(told).toBe(true)
  }, LOOKS)
}

const openWatches = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'FSEventWrap').length
/** A closed watch leaves the list of active resources on the event loop's next turn. */
const nextLoopTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

const views: View[] = []
function openView(): View {
  views.push(fakeView())
  return views.at(-1)!
}

let projectRoot: string
let otherRoot: string

beforeEach(() => {
  projectRoot = makeTempDir('fs-ipc-')
  otherRoot = makeTempDir('fs-ipc-other-')
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

describe('fs:watch-start', () => {
  it('tells the view that asked which file changed in its root', async () => {
    const view = openView()
    expect(await startWatch(view, projectRoot)).toEqual({ ok: true })
    await changeUntilTold(projectRoot, view)
    // A new watch can also report the making of its own directory, so the file is changed alone.
    view.received.length = 0
    await changeUntilTold(projectRoot, view)
    expect(view.received.map((event) => event.filename)).toContain('a.ts')
  })

  it('tells a view about its own root only', async () => {
    const [first, second] = [openView(), openView()]
    await startWatch(first, projectRoot)
    await startWatch(second, otherRoot)
    await changeUntilTold(projectRoot, first)
    await changeUntilTold(otherRoot, second)
    expect(new Set(first.received.map((event) => event.projectRoot))).toEqual(
      new Set([projectRoot])
    )
    expect(new Set(second.received.map((event) => event.projectRoot))).toEqual(new Set([otherRoot]))
  })
})

describe('fs:watch-start — shared roots and several roots', () => {
  it('tells every view watching the same root', async () => {
    const [first, second] = [openView(), openView()]
    await startWatch(first, projectRoot)
    await startWatch(second, projectRoot)
    await changeUntilTold(projectRoot, first)
    await changeUntilTold(projectRoot, second)
  })

  it('lets one view watch several roots', async () => {
    const view = openView()
    await startWatch(view, projectRoot)
    await startWatch(view, otherRoot)
    await changeUntilTold(projectRoot, view)
    await changeUntilTold(otherRoot, view)
  })

  it('rejects a payload without a root', async () => {
    expect(await invoke('fs:watch-start', openView(), {})).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('fs:watch-stop', () => {
  it('stops the watches of the view that asked, and nobody else’s', async () => {
    const [stopping, staying] = [openView(), openView()]
    await startWatch(stopping, projectRoot)
    await startWatch(staying, projectRoot)
    expect(await invoke('fs:watch-stop', stopping)).toEqual({ ok: true })
    await changeUntilTold(projectRoot, staying)
    expect(stopping.received).toEqual([])
  })

  it('closes a watch no view is left on', async () => {
    await nextLoopTurn()
    const before = openWatches()
    const view = openView()
    await startWatch(view, projectRoot)
    expect(openWatches()).toBeGreaterThan(before)
    await invoke('fs:watch-stop', view)
    await nextLoopTurn()
    expect(openWatches()).toBe(before)
  })
})

describe('a view that goes away', () => {
  async function watchesLeftAfter(leave: (view: View) => void): Promise<number> {
    await nextLoopTurn()
    const before = openWatches()
    const view = openView()
    await startWatch(view, projectRoot)
    leave(view)
    await nextLoopTurn()
    return openWatches() - before
  }

  it('gives up its watches when it is destroyed', async () => {
    expect(await watchesLeftAfter((view) => view.destroy())).toBe(0)
  })

  it('gives up its watches when it loads another page, as a reload does', async () => {
    const reload = { isMainFrame: true, isSameDocument: false }
    expect(await watchesLeftAfter((view) => view.navigate(reload))).toBe(0)
  })
})

describe('a view that stays', () => {
  it('can watch again from the page it loaded', async () => {
    const view = openView()
    await startWatch(view, projectRoot)
    view.navigate({ isMainFrame: true, isSameDocument: false })
    await startWatch(view, projectRoot)
    await changeUntilTold(projectRoot, view)
  })

  it.each([
    ['moves within its page', { isMainFrame: true, isSameDocument: true }],
    ['navigates a frame inside it', { isMainFrame: false, isSameDocument: false }],
  ])('keeps its watches when it %s', async (_how, navigation) => {
    const view = openView()
    await startWatch(view, projectRoot)
    view.navigate(navigation)
    await changeUntilTold(projectRoot, view)
  })
})

describe('fs:read-file', () => {
  it('returns the file’s content', async () => {
    const filePath = path.join(projectRoot, 'file.ts')
    fs.writeFileSync(filePath, 'file contents')
    expect(await invoke('fs:read-file', openView(), { filePath })).toEqual({
      content: 'file contents',
    })
  })

  it('returns FILE_NOT_FOUND for a file that is not there', async () => {
    const filePath = path.join(projectRoot, 'missing.ts')
    expect(await invoke('fs:read-file', openView(), { filePath })).toEqual({
      error: 'FILE_NOT_FOUND',
    })
  })
})
