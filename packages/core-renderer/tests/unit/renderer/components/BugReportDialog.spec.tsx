import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import type { ReportAttachment } from '../../../../../core-shared/src/bug-report'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { BugReportHost } from '../../../../src/components/BugReportDialog'
import { useBugReportStore } from '../../../../src/stores/bug-report.store'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

const api = {
  status: vi.fn<ElectronAPI['bugReport']['status']>(),
  details: vi.fn<ElectronAPI['bugReport']['details']>(),
  capture: vi.fn<ElectronAPI['bugReport']['capture']>(),
  pick: vi.fn<ElectronAPI['bugReport']['pick']>(),
  submit: vi.fn<ElectronAPI['bugReport']['submit']>(),
  openInBrowser: vi.fn<ElectronAPI['bugReport']['openInBrowser']>(),
}
const openExternal = vi.fn<ElectronAPI['shell']['openExternal']>()

const SCREENSHOT: ReportAttachment = {
  path: '/reports/captures/window.png',
  name: 'window.png',
  bytes: 2048,
  kind: 'image',
  problem: null,
  thumbnail: 'data:image/png;base64,AAAA',
}

const BIG_VIDEO: ReportAttachment = {
  path: '/picked/repro.mov',
  name: 'repro.mov',
  bytes: 11 * 1024 * 1024,
  kind: 'video',
  problem: 'repro.mov is larger than 10 MB, the most GitHub takes.',
  thumbnail: null,
}

beforeEach(() => {
  installElectronApi({ bugReport: api, shell: { openExternal } })
  api.status.mockResolvedValue({ ready: true, login: 'octocat' })
  api.details.mockResolvedValue({ details: 'Terminator 0.1.198 · macOS 15.6 (arm64)' })
  useBugReportStore.setState(useBugReportStore.getInitialState())
  useBugReportStore.getState().openReport({ origin: 'Code Reviews' })
})

async function fillIn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Title'), 'Diff view goes blank')
  await user.type(screen.getByLabelText('What happened, and what you expected'), 'It went empty.')
}

describe('BugReportDialog, gh signed in', () => {
  it('warns that the report is public and names the account it posts as', async () => {
    render(<BugReportHost />)

    expect(screen.getByText(/becomes a public issue/)).toBeTruthy()
    expect(screen.getByText('from: Code Reviews')).toBeTruthy()
    expect(await screen.findByText('Posting as @octocat')).toBeTruthy()
    expect(recordUse).toHaveBeenCalledWith('core.bug-report', 'shown')
  })

  it('posts the report with what was typed, the screen and the app details', async () => {
    const user = userEvent.setup()
    api.submit.mockResolvedValue({
      ok: true,
      number: 418,
      url: 'https://github.com/o/r/issues/418',
    })
    render(<BugReportHost />)
    await screen.findByText('Posting as @octocat')

    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Post issue' }))

    expect(api.submit).toHaveBeenCalledWith({
      title: 'Diff view goes blank',
      description: 'It went empty.',
      origin: 'Code Reviews',
      includeDetails: true,
      files: [],
    })
    expect(await screen.findByText('Issue #418 posted')).toBeTruthy()
  })
})

describe('BugReportDialog, required title', () => {
  it('cannot post without a title', async () => {
    render(<BugReportHost />)
    await screen.findByText('Posting as @octocat')

    expect(screen.getByRole('button', { name: 'Post issue' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('BugReportDialog, app details', () => {
  it('shows the app details it will send, and leaves them out when unticked', async () => {
    const user = userEvent.setup()
    api.submit.mockResolvedValue({ ok: true, number: 1, url: 'https://github.com/o/r/issues/1' })
    render(<BugReportHost />)

    expect(await screen.findByText('Terminator 0.1.198 · macOS 15.6 (arm64)')).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: 'Include app details' }))
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Post issue' }))

    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ includeDetails: false }))
  })
})

describe('BugReportDialog, without gh', () => {
  it('says why and finishes the report in the browser', async () => {
    const user = userEvent.setup()
    api.status.mockResolvedValue({ ready: false, reason: 'no-gh' })
    api.openInBrowser.mockResolvedValue({ ok: true })
    render(<BugReportHost />)

    expect(await screen.findByText(/GitHub CLI \(gh\) is not installed/)).toBeTruthy()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Continue in browser' }))

    expect(api.openInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Diff view goes blank' })
    )
    expect(await screen.findByText(/Drag the files from the Finder window/)).toBeTruthy()
  })

  it('tells a signed-out user how to sign in', async () => {
    api.status.mockResolvedValue({ ready: false, reason: 'signed-out' })
    render(<BugReportHost />)

    expect(await screen.findByText(/gh auth login/)).toBeTruthy()
  })
})

describe('BugReportDialog, attachments', () => {
  it('adds a capture of the window, shown as a thumbnail, and posts it', async () => {
    const user = userEvent.setup()
    api.capture.mockResolvedValue({ ok: true, attachment: SCREENSHOT })
    api.submit.mockResolvedValue({ ok: true, number: 2, url: 'https://github.com/o/r/issues/2' })
    render(<BugReportHost />)
    await screen.findByText('Posting as @octocat')

    await user.click(screen.getByRole('button', { name: 'Capture window' }))
    expect(await screen.findByAltText('window.png')).toBeTruthy()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Post issue' }))

    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ files: [SCREENSHOT.path] }))
  })

  it('names a file GitHub would refuse and will not post until it is removed', async () => {
    const user = userEvent.setup()
    api.pick.mockResolvedValue({ attachments: [BIG_VIDEO] })
    render(<BugReportHost />)
    await screen.findByText('Posting as @octocat')
    await fillIn(user)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    expect(await screen.findByText(BIG_VIDEO.problem!)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Post issue' }).hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Remove repro.mov' }))
    expect(screen.getByRole('button', { name: 'Post issue' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('BugReportDialog, after posting', () => {
  it('opens the posted issue on GitHub', async () => {
    const user = userEvent.setup()
    useBugReportStore.setState({
      phase: { name: 'posted', ok: true, number: 418, url: 'https://github.com/o/r/issues/418' },
    })
    render(<BugReportHost />)

    await user.click(screen.getByRole('button', { name: 'Open on GitHub' }))

    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/issues/418')
  })

  it('shows a failure and offers the browser as well as trying again', async () => {
    useBugReportStore.setState({
      phase: { name: 'failed', error: 'SIGNED_OUT', message: 'HTTP 401: Bad credentials' },
    })
    render(<BugReportHost />)

    expect(await screen.findByText('HTTP 401: Bad credentials')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Post issue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue in browser' })).toBeTruthy()
  })

  it('draws nothing while closed', () => {
    useBugReportStore.getState().close()
    const { container } = render(<BugReportHost />)

    expect(container.innerHTML).toBe('')
  })
})
