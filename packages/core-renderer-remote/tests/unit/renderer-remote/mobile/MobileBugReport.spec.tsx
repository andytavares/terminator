import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as RemoteClient from '../../../../src/api/remote-client'
import { MobileBugReport } from '../../../../src/components/MobileBugReport'

const status = vi.fn<typeof RemoteClient.bugReportStatus>()
const details = vi.fn<typeof RemoteClient.bugReportDetails>()
const submitUploaded = vi.fn<typeof RemoteClient.submitBugReport>()

// The desktop is reached over the remote server's HTTP routes; that is the boundary.
vi.mock('../../../../src/api/remote-client', () => ({
  bugReportStatus: () => status(),
  bugReportDetails: () => details(),
  submitBugReport: (report: Parameters<typeof RemoteClient.submitBugReport>[0]) =>
    submitUploaded(report),
}))

beforeEach(() => {
  status.mockResolvedValue({ ready: true, login: 'octocat' })
  details.mockResolvedValue({ details: 'Terminator 0.1.198 · macOS 15.6 (arm64)' })
})

async function describeBug(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Title'), 'Tile frozen')
  await user.type(screen.getByLabelText('What happened, and what you expected'), 'Stayed grey.')
}

describe('MobileBugReport, desktop gh signed in', () => {
  it('warns that the report is public and posts it with the phone’s files', async () => {
    const user = userEvent.setup()
    submitUploaded.mockResolvedValue({
      ok: true,
      number: 7,
      url: 'https://github.com/o/r/issues/7',
    })
    render(<MobileBugReport onBack={vi.fn()} />)
    expect(screen.getByText(/becomes a public issue/)).toBeTruthy()
    expect(await screen.findByText('Posting as @octocat')).toBeTruthy()

    await describeBug(user)
    await user.upload(screen.getByLabelText('Photos or videos'), new File(['png'], 'IMG_1.png'))
    await user.click(screen.getByRole('button', { name: 'Post issue' }))

    expect(submitUploaded).toHaveBeenCalledWith({
      title: 'Tile frozen',
      description: 'Stayed grey.',
      origin: 'Phone remote',
      includeDetails: true,
      uploads: [{ name: 'IMG_1.png', data: btoa('png') }],
    })
    expect(await screen.findByText('Issue #7 posted')).toBeTruthy()
  })
})

describe('MobileBugReport, files the desktop would refuse', () => {
  it('names the file and will not post it', async () => {
    // A picker honours accept; a browser that ignores it must still not post the file.
    const user = userEvent.setup({ applyAccept: false })
    render(<MobileBugReport onBack={vi.fn()} />)
    await screen.findByText('Posting as @octocat')
    await describeBug(user)

    await user.upload(screen.getByLabelText('Photos or videos'), new File(['x'], 'notes.txt'))

    expect(screen.getByText('notes.txt is not an image or a video GitHub accepts.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Post issue' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('MobileBugReport, desktop without gh', () => {
  it('links to the filled-in GitHub form, to attach the files there', async () => {
    const user = userEvent.setup()
    status.mockResolvedValue({ ready: false, reason: 'no-gh' })
    render(<MobileBugReport onBack={vi.fn()} />)
    await screen.findByText(/attach your photos and videos in GitHub’s form/)

    await describeBug(user)
    const link = screen.getByRole('link', { name: 'Open GitHub' })

    const url = new URL(link.getAttribute('href')!)
    expect(url.searchParams.get('title')).toBe('Tile frozen')
    expect(url.searchParams.get('opened-from')).toBe('Phone remote')
  })
})

describe('MobileBugReport, leaving', () => {
  it('goes back to the terminal list', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<MobileBugReport onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(onBack).toHaveBeenCalled()
  })
})
