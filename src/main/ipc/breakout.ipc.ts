import { BrowserWindow, screen } from 'electron'
import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'

function isInside(point: { x: number; y: number }, bounds: Electron.Rectangle): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

export function registerBreakoutHandlers(): void {
  registerInvokeTable([
    defineChannel({
      channel: 'breakout:pointer-outside',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: () => {
        const point = screen.getCursorScreenPoint()
        const outside = !BrowserWindow.getAllWindows().some((win) =>
          isInside(point, win.getBounds())
        )
        return { outside, x: point.x, y: point.y }
      },
    }),
  ])
}
