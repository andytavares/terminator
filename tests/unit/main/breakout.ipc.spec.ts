import { describe, it, expect, vi, beforeEach } from 'vitest'

const cursor = { x: 0, y: 0 }
interface FakeWindow {
  getBounds: () => Electron.Rectangle
  isVisible: () => boolean
  isMinimized: () => boolean
}
const windows: FakeWindow[] = []
const background = { on: false }
vi.mock('../../../src/main/background-mode', () => ({ runsInBackground: () => background.on }))
vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: () => cursor },
  BrowserWindow: { getAllWindows: () => windows },
}))

let rows: Array<{ channel: string; run: (args: unknown) => unknown }> = []
vi.mock('../../../src/main/ipc/invoke-table', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerInvokeTable: (table: typeof rows) => {
    rows = table
  },
}))

import { registerBreakoutHandlers } from '../../../src/main/ipc/breakout.ipc'

const windowAt = (
  bounds: Electron.Rectangle,
  shown: { visible?: boolean; minimized?: boolean } = {}
): FakeWindow => ({
  getBounds: () => bounds,
  isVisible: () => shown.visible ?? true,
  isMinimized: () => shown.minimized ?? false,
})

function pointerOutside() {
  registerBreakoutHandlers()
  return rows.find((row) => row.channel === 'breakout:pointer-outside')!.run(undefined)
}

describe('breakout:pointer-outside', () => {
  beforeEach(() => {
    background.on = false
    windows.length = 0
    windows.push(
      windowAt({ x: 0, y: 0, width: 1000, height: 800 }),
      windowAt({ x: 1200, y: 100, width: 400, height: 300 })
    )
  })

  it('is not outside while the pointer is over any window', () => {
    Object.assign(cursor, { x: 1300, y: 200 })
    expect(pointerOutside()).toEqual({ outside: false, x: 1300, y: 200 })
  })

  it('is outside when the pointer is over none, and reports where', () => {
    Object.assign(cursor, { x: 1100, y: 500 })
    expect(pointerOutside()).toEqual({ outside: true, x: 1100, y: 500 })
  })

  it('treats a window edge as inside on the near side and outside on the far side', () => {
    Object.assign(cursor, { x: 0, y: 0 })
    expect(pointerOutside()).toMatchObject({ outside: false })
    Object.assign(cursor, { x: 1000, y: 800 })
    expect(pointerOutside()).toMatchObject({ outside: true })
  })
})

describe('breakout:pointer-outside — windows the pointer cannot be over', () => {
  beforeEach(() => {
    background.on = false
  })

  it('ignores hidden and minimised windows, which the pointer cannot be over', () => {
    windows.length = 0
    const bounds = { x: 0, y: 0, width: 1000, height: 800 }
    windows.push(windowAt(bounds, { visible: false }), windowAt(bounds, { minimized: true }))
    Object.assign(cursor, { x: 10, y: 10 })
    expect(pointerOutside()).toMatchObject({ outside: true })
  })

  it('counts hidden windows when the app runs in the background, as e2e runs do', () => {
    background.on = true
    windows.length = 0
    windows.push(windowAt({ x: 0, y: 0, width: 1000, height: 800 }, { visible: false }))
    Object.assign(cursor, { x: 10, y: 10 })
    expect(pointerOutside()).toMatchObject({ outside: false })
  })
})
