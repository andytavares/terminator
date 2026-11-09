import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShellExecInput, ShellExecOutput } from '../../../src/shell/shell-executor'
import type { ReportFile } from '../../../src/bug-report/report-files'

const { mockHandle, recordUse } = vi.hoisted(() => ({ mockHandle: vi.fn(), recordUse: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }))
vi.mock('../../../src/usage/usage-store.js', () => ({ getUsageStore: () => ({ recordUse }) }))

import { registerBugReportHandlers, type BugReportDeps } from '../../../src/ipc/bug-report.ipc.js'

const CAPTURE: ReportFile = { path: '/reports/captures/window.png', name: 'window.png', bytes: 3 }
const VIDEO: ReportFile = { path: '/picked/repro.mov', name: 'repro.mov', bytes: 11 * 1024 * 1024 }

function output(overrides: Partial<ShellExecOutput> = {}): ShellExecOutput {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    exceededMaxBuffer: false,
    ...overrides,
  }
}

function handlerFor(channel: string): (event: unknown, payload?: unknown) => Promise<unknown> {
  const match = mockHandle.mock.calls.find(([name]) => name === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => Promise<unknown>
}

function fakeDeps(): BugReportDeps & { granted: Set<string> } {
  const granted = new Set<string>()
  return {
    granted,
    run: vi.fn(async (_input: ShellExecInput) => output()),
    cwd: '/home/me',
    files: {
      saveCapture: vi.fn(async () => (granted.add(CAPTURE.path), CAPTURE)),
      add: vi.fn(async (paths: readonly string[]) =>
        paths.map((path) => (granted.add(path), path === VIDEO.path ? VIDEO : CAPTURE))
      ),
      isGranted: (path: string) => granted.has(path),
      saveUpload: vi.fn(async (name: string, data: Buffer) => {
        const file = { path: `/reports/uploads/${name}`, name, bytes: data.length }
        granted.add(file.path)
        return file
      }),
      gather: vi.fn(async (paths: readonly string[]) =>
        paths.map((p) => `/reports/gathered/${p.split('/').pop()}`)
      ),
    },
    appDetails: () => 'Terminator 0.1.198 · macOS 15.6 (arm64)',
    captureWindow: vi.fn(async () => Buffer.from('png')),
    thumbnail: vi.fn((path: string) => `data:image/png;base64,${path.length}`),
    pickFiles: vi.fn(async () => [VIDEO.path]),
    openExternal: vi.fn(),
    showInFolder: vi.fn(),
    now: () => new Date('2026-11-09T14:02:03Z'),
  }
}

const REPORT = {
  title: 'Diff view goes blank',
  description: 'The diff went empty.',
  origin: 'Code Reviews',
  includeDetails: true,
  files: [] as string[],
}

let deps: ReturnType<typeof fakeDeps>

beforeEach(() => {
  recordUse.mockResolvedValue(undefined)
  deps = fakeDeps()
  registerBugReportHandlers(deps)
})

describe('bug-report:status', () => {
  it('answers whether gh can post, as whom', async () => {
    vi.mocked(deps.run)
      .mockResolvedValueOnce(output({ stdout: '--attach file' }))
      .mockResolvedValueOnce(output({ stdout: 'octocat\n' }))

    expect(await handlerFor('bug-report:status')({})).toEqual({ ready: true, login: 'octocat' })
  })
})

describe('bug-report:details', () => {
  it('answers the app details the report would carry', async () => {
    expect(await handlerFor('bug-report:details')({})).toEqual({
      details: 'Terminator 0.1.198 · macOS 15.6 (arm64)',
    })
  })
})

describe('bug-report:capture', () => {
  it('saves the window as an attachment with a thumbnail', async () => {
    expect(await handlerFor('bug-report:capture')({})).toEqual({
      ok: true,
      attachment: { ...CAPTURE, kind: 'image', problem: null, thumbnail: expect.any(String) },
    })
    expect(deps.thumbnail).toHaveBeenCalledWith(CAPTURE.path)
  })

  it('says so when there is no window to capture', async () => {
    vi.mocked(deps.captureWindow).mockResolvedValue(null)

    expect(await handlerFor('bug-report:capture')({})).toEqual({
      ok: false,
      error: 'CAPTURE_FAILED',
      message: 'There is no window to capture.',
    })
  })
})

describe('bug-report:pick', () => {
  it('hands out the chosen files, flagging one GitHub would refuse, with no thumbnail for video', async () => {
    expect(await handlerFor('bug-report:pick')({})).toEqual({
      attachments: [
        {
          ...VIDEO,
          kind: 'video',
          problem: 'repro.mov is larger than 10 MB, the most GitHub takes.',
          thumbnail: null,
        },
      ],
    })
  })
})

describe('bug-report:submit', () => {
  it('files the issue with the report body and the handed-out files', async () => {
    await handlerFor('bug-report:capture')({})
    vi.mocked(deps.run).mockResolvedValue(
      output({ stdout: 'https://github.com/andytavares/terminator/issues/418\n' })
    )

    const reply = await handlerFor('bug-report:submit')({}, { ...REPORT, files: [CAPTURE.path] })

    expect(reply).toEqual({
      ok: true,
      number: 418,
      url: 'https://github.com/andytavares/terminator/issues/418',
    })
    const call = vi.mocked(deps.run).mock.calls[0][0]
    expect(call.args).toContain(CAPTURE.path)
    expect(call.input).toContain('The diff went empty.')
    expect(call.input).toContain('Terminator 0.1.198 · macOS 15.6 (arm64)')
    expect(recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'core.bug-report.post' })
    )
  })

  it('leaves the app details out when the user unticked them', async () => {
    vi.mocked(deps.run).mockResolvedValue(output({ stdout: 'https://github.com/o/r/issues/1\n' }))

    await handlerFor('bug-report:submit')({}, { ...REPORT, includeDetails: false })

    expect(vi.mocked(deps.run).mock.calls[0][0].input).not.toContain('Terminator 0.1.198')
  })
})

describe('bug-report:submit, refused', () => {
  it('refuses a file it never handed out, without running gh', async () => {
    const reply = await handlerFor('bug-report:submit')({}, { ...REPORT, files: ['/etc/passwd'] })

    expect(reply).toEqual({
      ok: false,
      error: 'VALIDATION_ERROR',
      message: 'A file was not added through the report.',
    })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('refuses a file GitHub would refuse, without running gh', async () => {
    await handlerFor('bug-report:pick')({})

    const reply = await handlerFor('bug-report:submit')({}, { ...REPORT, files: [VIDEO.path] })

    expect(reply).toEqual({
      ok: false,
      error: 'VALIDATION_ERROR',
      message: 'repro.mov is larger than 10 MB, the most GitHub takes.',
    })
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('bug-report:open-in-browser', () => {
  it('gathers the files, shows them in Finder and opens the filled-in form', async () => {
    await handlerFor('bug-report:capture')({})

    const reply = await handlerFor('bug-report:open-in-browser')(
      {},
      { ...REPORT, files: [CAPTURE.path] }
    )

    expect(reply).toEqual({ ok: true })
    expect(deps.showInFolder).toHaveBeenCalledWith('/reports/gathered/window.png')
    const url = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    expect(url.searchParams.get('title')).toBe('Diff view goes blank')
    expect(url.searchParams.get('app-details')).toBe('Terminator 0.1.198 · macOS 15.6 (arm64)')
    expect(recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'core.bug-report.browser' })
    )
  })

  it('opens the form without showing a folder when there are no files', async () => {
    await handlerFor('bug-report:open-in-browser')({}, REPORT)

    expect(deps.showInFolder).not.toHaveBeenCalled()
    expect(deps.openExternal).toHaveBeenCalledOnce()
  })

  it('refuses a file it never handed out', async () => {
    const reply = await handlerFor('bug-report:open-in-browser')(
      {},
      { ...REPORT, files: ['/etc/passwd'] }
    )

    expect(reply).toMatchObject({ ok: false, error: 'VALIDATION_ERROR' })
    expect(deps.openExternal).not.toHaveBeenCalled()
  })
})

const upload = (name: string, text: string) => ({
  name,
  data: Buffer.from(text).toString('base64'),
})

describe('bug-report:submit-uploaded', () => {
  it('saves the phone’s files and files the issue with them', async () => {
    vi.mocked(deps.run).mockResolvedValue(
      output({ stdout: 'https://github.com/andytavares/terminator/issues/9\n' })
    )

    const reply = await handlerFor('bug-report:submit-uploaded')(
      {},
      { ...REPORT, files: undefined, uploads: [upload('IMG_1.PNG', 'png')] }
    )

    expect(reply).toMatchObject({ ok: true, number: 9 })
    expect(deps.files.saveUpload).toHaveBeenCalledWith(
      'IMG_1.PNG',
      Buffer.from('png'),
      expect.any(Date)
    )
    expect(vi.mocked(deps.run).mock.calls[0][0].args).toContain('/reports/uploads/IMG_1.PNG')
  })
})

describe('bug-report:submit-uploaded, refused', () => {
  it('refuses a file GitHub would refuse, saving nothing', async () => {
    const reply = await handlerFor('bug-report:submit-uploaded')(
      {},
      { ...REPORT, uploads: [upload('notes.txt', 'text')] }
    )

    expect(reply).toEqual({
      ok: false,
      error: 'VALIDATION_ERROR',
      message: 'notes.txt is not an image or a video GitHub accepts.',
    })
    expect(deps.files.saveUpload).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })
})
