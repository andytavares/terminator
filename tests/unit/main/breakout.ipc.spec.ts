import { describe, it, expect, vi, beforeEach } from 'vitest'

const cursor = { x: 0, y: 0 }
const windows: Array<{ getBounds: () => Electron.Rectangle }> = []
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

const windowAt = (bounds: Electron.Rectangle) => ({ getBounds: () => bounds })

function pointerOutside() {
  registerBreakoutHandlers()
  return rows.find((row) => row.channel === 'breakout:pointer-outside')!.run(undefined)
}

describe('breakout:pointer-outside', () => {
  beforeEach(() => {
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
