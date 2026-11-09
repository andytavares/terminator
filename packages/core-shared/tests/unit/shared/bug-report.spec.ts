import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_NEW_ISSUE_URL_LENGTH,
  attachmentKind,
  attachmentProblem,
  newIssueUrl,
  reportBody,
} from '../../../src/bug-report'

const REPORT = {
  title: 'Diff view goes blank',
  description: 'Moved to chapter 3 and the diff went empty.',
  origin: 'Code Reviews',
  details: 'Terminator 0.1.198 · macOS 15.6 (arm64)',
}

describe('attachments', () => {
  it('knows the image and video types GitHub accepts, whatever the case', () => {
    expect(attachmentKind('window.PNG')).toBe('image')
    expect(attachmentKind('repro.mov')).toBe('video')
    expect(attachmentKind('notes.txt')).toBeNull()
  })

  it('refuses a file that is not an image or a video', () => {
    expect(attachmentProblem('notes.txt', 10)).toBe(
      'notes.txt is not an image or a video GitHub accepts.'
    )
  })

  it('refuses a file over the size limit and names the limit', () => {
    expect(attachmentProblem('repro.mov', MAX_ATTACHMENT_BYTES + 1)).toBe(
      'repro.mov is larger than 10 MB, the most GitHub takes.'
    )
  })

  it('accepts an image or video within the limit', () => {
    expect(attachmentProblem('repro.mp4', MAX_ATTACHMENT_BYTES)).toBeNull()
  })
})

describe('reportBody', () => {
  it('holds the description, where it was opened, the app details and a sign-off', () => {
    const body = reportBody(REPORT)

    expect(body).toContain('Moved to chapter 3 and the diff went empty.')
    expect(body).toContain('**Opened from:** Code Reviews')
    expect(body).toContain('<summary>App details</summary>')
    expect(body).toContain('Terminator 0.1.198 · macOS 15.6 (arm64)')
    expect(body.trimEnd().endsWith("Sent from Terminator's bug reporter.")).toBe(true)
  })

  it('leaves the app details out when the user unticked them', () => {
    expect(reportBody({ ...REPORT, details: null })).not.toContain('App details')
  })
})

describe('newIssueUrl', () => {
  it('fills the bug report form of the repository', () => {
    const url = new URL(newIssueUrl(REPORT))

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://github.com/andytavares/terminator/issues/new'
    )
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('title')).toBe(REPORT.title)
    expect(url.searchParams.get('what-happened')).toBe(REPORT.description)
    expect(url.searchParams.get('opened-from')).toBe('Code Reviews')
    expect(url.searchParams.get('app-details')).toBe(REPORT.details)
  })

  it('leaves the app details field empty when the user unticked them', () => {
    const url = new URL(newIssueUrl({ ...REPORT, details: null }))

    expect(url.searchParams.has('app-details')).toBe(false)
  })

  it('cuts a long description short so the link stays within the limit, and says so', () => {
    const url = newIssueUrl({ ...REPORT, description: 'word '.repeat(5000) })

    expect(url.length).toBeLessThanOrEqual(MAX_NEW_ISSUE_URL_LENGTH)
    expect(new URL(url).searchParams.get('what-happened')).toMatch(
      /\(Cut short: the rest did not fit in the link\.\)$/
    )
  })
})
