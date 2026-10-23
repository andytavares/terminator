import { BrowserWindow, screen } from 'electron'
import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { runsInBackground } from '../background-mode.js'

function isInside(point: { x: number; y: number }, bounds: Electron.Rectangle): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

/** A window the pointer can be over. In the background every window is hidden yet still drawn. */
function canBeUnderPointer(win: BrowserWindow): boolean {
  return runsInBackground() || (win.isVisible() && !win.isMinimized())
}

export function registerBreakoutHandlers(): void {
  registerInvokeTable([
    defineChannel({
      channel: 'breakout:pointer-outside',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: () => {
        const point = screen.getCursorScreenPoint()
        const outside = !BrowserWindow.getAllWindows().some(
          (win) => canBeUnderPointer(win) && isInside(point, win.getBounds())
        )
        return { outside, x: point.x, y: point.y }
      },
    }),
  ])
}
