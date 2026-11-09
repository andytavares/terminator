import { app, dialog, nativeImage, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ATTACHMENT_EXTENSIONS } from '../../../core-shared/src/bug-report.js'
import { execShell } from '../shell/shell-executor.js'
import type { BugReportDeps } from '../ipc/bug-report.ipc.js'
import { createReportFiles } from './report-files.js'

// What the bug report handlers reach in the running app: gh, the window, the file picker and the
// browser. Kept here so bug-report.ipc.ts holds only the decisions.

const SYSTEM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
const THUMBNAIL_WIDTH = 240

/** The window a report started from, when the Help menu started it: a breakout window, or the
 * main window. A report started inside the main window captures the main window. */
let sourceWindow: BrowserWindow | null = null

export function setReportSourceWindow(win: BrowserWindow | null): void {
  sourceWindow = win
}

interface ExtensionSummary {
  id: string
  version: string
}

interface SystemFacts {
  platform: string
  /** The OS's own version, e.g. 15.6 on macOS: Electron's `process.getSystemVersion()`. */
  version: string
  arch: string
}

interface AppFacts {
  name: string
  version: string
}

export function appDetailsText(
  application: AppFacts,
  system: SystemFacts,
  extensions: readonly ExtensionSummary[]
): string {
  const systemName = SYSTEM_NAMES[system.platform] ?? system.platform
  const lines = [
    `${application.name} ${application.version} · ${systemName} ${system.version} (${system.arch})`,
  ]
  if (extensions.length > 0) {
    lines.push(`Extensions: ${extensions.map(({ id, version }) => `${id} ${version}`).join(', ')}`)
  }
  return lines.join('\n')
}

function thumbnail(path: string): string | null {
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? null : image.resize({ width: THUMBNAIL_WIDTH }).toDataURL()
}

async function pickFiles(win: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images and videos', extensions: [...ATTACHMENT_EXTENSIONS] }],
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

async function capture(win: BrowserWindow | null): Promise<Buffer | null> {
  return win ? (await win.webContents.capturePage()).toPNG() : null
}

export function electronBugReportDeps(
  getMainWindow: () => BrowserWindow | null,
  listExtensions: () => readonly ExtensionSummary[]
): BugReportDeps {
  const captureTarget = () =>
    sourceWindow && !sourceWindow.isDestroyed() ? sourceWindow : getMainWindow()
  const system = () => ({
    platform: process.platform,
    version: process.getSystemVersion(),
    arch: process.arch,
  })
  return {
    run: execShell,
    cwd: app.getPath('home'),
    files: createReportFiles(join(app.getPath('userData'), 'reports')),
    appDetails: () =>
      appDetailsText(
        { name: app.getName(), version: app.getVersion() },
        system(),
        listExtensions()
      ),
    captureWindow: () => capture(captureTarget()),
    thumbnail,
    pickFiles: () => pickFiles(getMainWindow()),
    openExternal: (url) => void shell.openExternal(url),
    showInFolder: (path) => shell.showItemInFolder(path),
    now: () => new Date(),
  }
}
