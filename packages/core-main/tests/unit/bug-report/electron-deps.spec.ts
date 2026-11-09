import { describe, expect, it, vi } from 'vitest'

const { showOpenDialog, createFromPath, getPath } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  createFromPath: vi.fn(),
  getPath: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath, getName: () => 'Terminator', getVersion: () => '0.1.198' },
  dialog: { showOpenDialog },
  nativeImage: { createFromPath },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

import {
  appDetailsText,
  electronBugReportDeps,
  setReportSourceWindow,
} from '../../../src/bug-report/electron-deps'

function fakeWindow(png: string, destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from(png) })) },
  } as unknown as Electron.BrowserWindow
}

function deps(mainWindow: Electron.BrowserWindow | null) {
  getPath.mockReturnValue('/home/me')
  return electronBugReportDeps(
    () => mainWindow,
    () => [{ id: 'git-integration', version: '3.4.0' }]
  )
}

const APP = { name: 'Terminator', version: '0.1.198' }
const MAC = { platform: 'darwin', version: '15.6', arch: 'arm64' }

describe('appDetailsText', () => {
  it('names the app, the system and the installed extensions', () => {
    const text = appDetailsText(APP, MAC, [
      { id: 'foundry', version: '2.0.0' },
      { id: 'notepad', version: '1.1.0' },
    ])

    expect(text.split('\n')[0]).toBe('Terminator 0.1.198 · macOS 15.6 (arm64)')
    expect(text).toContain('Extensions: foundry 2.0.0, notepad 1.1.0')
  })

  it('has no extensions line when none are installed', () => {
    expect(appDetailsText(APP, MAC, [])).not.toContain('Extensions')
  })
})

describe('electronBugReportDeps, capture', () => {
  it('captures the window the report was started from', async () => {
    const breakout = fakeWindow('breakout')
    setReportSourceWindow(breakout)

    expect((await deps(fakeWindow('main')).captureWindow())?.toString()).toBe('breakout')
  })

  it('captures the main window once the source window is gone', async () => {
    setReportSourceWindow(fakeWindow('closed', true))

    expect((await deps(fakeWindow('main')).captureWindow())?.toString()).toBe('main')
  })

  it('has nothing to capture without a window', async () => {
    setReportSourceWindow(null)

    expect(await deps(null).captureWindow()).toBeNull()
  })
})

describe('electronBugReportDeps, files and details', () => {
  it('offers only images and videos in the file picker, and answers nothing when cancelled', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/a.png'] })
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const reportDeps = deps(null)

    expect(await reportDeps.pickFiles()).toEqual(['/a.png'])
    expect(await reportDeps.pickFiles()).toEqual([])
    expect(showOpenDialog.mock.calls[0][0].filters[0].extensions).toContain('mov')
  })

  it('draws a thumbnail of an image, and none of a file it cannot draw', () => {
    const toDataURL = () => 'data:image/png;base64,AAA'
    createFromPath
      .mockReturnValueOnce({ isEmpty: () => false, resize: () => ({ toDataURL }) })
      .mockReturnValueOnce({ isEmpty: () => true })
    const reportDeps = deps(null)

    expect(reportDeps.thumbnail('/a.png')).toBe('data:image/png;base64,AAA')
    expect(reportDeps.thumbnail('/broken.png')).toBeNull()
  })

  it('carries the app details with the installed extensions', () => {
    // Electron adds getSystemVersion to process; Node has none.
    Object.defineProperty(process, 'getSystemVersion', { value: () => '15.6', configurable: true })
    expect(deps(null).appDetails()).toContain('Extensions: git-integration 3.4.0')
  })
})
