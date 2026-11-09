// A bug report is a public issue on the app's own GitHub repository (ADR 156). This module holds
// the parts every surface agrees on: which files GitHub takes, the issue body, and the link that
// fills the issue form in a browser. Pure, so the main process, the renderer and the phone client
// build the same report.

export const REPORT_REPOSITORY = 'andytavares/terminator'

/** The issue form in `.github/ISSUE_TEMPLATE/` the browser path fills. Its field ids are the
 * query keys below. */
const ISSUE_FORM = 'bug_report.yml'

/** GitHub's limit for an image, and for a video in a repository on a free plan: the lowest limit
 * that applies, so a file under it is never refused
 * (https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** GitHub answers 414 past a server limit it does not publish
 * (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query).
 * 8,000 characters is our own bound, well inside what browsers and servers commonly accept. */
export const MAX_NEW_ISSUE_URL_LENGTH = 8000

const CUT_SHORT = '\n\n(Cut short: the rest did not fit in the link.)'

export type AttachmentKind = 'image' | 'video'

// The image and video types `gh issue create --attach` and GitHub's attachments accept.
const KIND_BY_EXTENSION: ReadonlyMap<string, AttachmentKind> = new Map([
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['webp', 'image'],
  ['mp4', 'video'],
  ['mov', 'video'],
  ['webm', 'video'],
])

/** The extensions a file picker offers. */
export const ATTACHMENT_EXTENSIONS: readonly string[] = [...KIND_BY_EXTENSION.keys()]

/** Whether this machine can post a report with attachments through gh, and as whom. */
export type ReportingStatus =
  { ready: true; login: string } | { ready: false; reason: 'no-gh' | 'no-attach' | 'signed-out' }

/** A file the main process handed out for a report, as the dialog shows it. */
export interface ReportAttachment {
  path: string
  name: string
  bytes: number
  kind: AttachmentKind | null
  /** Why GitHub would refuse it; null when it would take it. */
  problem: string | null
  /** A small data URL for an image; null for a video. */
  thumbnail: string | null
}

/** What the dialog sends to post a report or to open it in the browser. */
export interface ReportSubmission {
  title: string
  description: string
  origin: string
  includeDetails: boolean
  /** Paths of attachments the main process handed out. */
  files: string[]
}

/** A report from the phone: its files travel with it, as base64. */
export interface UploadedReport extends Omit<ReportSubmission, 'files'> {
  uploads: Array<{ name: string; data: string }>
}

export interface ReportFailure {
  ok: false
  error: 'SIGNED_OUT' | 'FAILED' | 'VALIDATION_ERROR' | 'CAPTURE_FAILED'
  message: string
}

export interface ReportText {
  title: string
  description: string
  /** The screen the report was started from, in the words the user sees. */
  origin: string
  /** App and system versions; null when the user chose not to send them. */
  details: string | null
}

export function attachmentKind(fileName: string): AttachmentKind | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return KIND_BY_EXTENSION.get(extension) ?? null
}

/** Why GitHub would refuse this file, or null when it would take it. */
export function attachmentProblem(fileName: string, bytes: number): string | null {
  if (attachmentKind(fileName) === null) {
    return `${fileName} is not an image or a video GitHub accepts.`
  }
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return `${fileName} is larger than 10 MB, the most GitHub takes.`
  }
  return null
}

/** The issue body: what happened, where, the app details folded away, and a line marking it as
 * sent from the app. */
export function reportBody({ description, origin, details }: ReportText): string {
  const parts = [description.trim(), `**Opened from:** ${origin}`]
  if (details !== null) {
    parts.push(
      ['<details><summary>App details</summary>', '', '```', details, '```', '', '</details>'].join(
        '\n'
      )
    )
  }
  parts.push("Sent from Terminator's bug reporter.")
  return `${parts.join('\n\n')}\n`
}

function formUrl({ title, description, origin, details }: ReportText): string {
  const query = new URLSearchParams({
    template: ISSUE_FORM,
    title,
    'what-happened': description,
    'opened-from': origin,
  })
  if (details !== null) query.set('app-details', details)
  return `https://github.com/${REPORT_REPOSITORY}/issues/new?${query.toString()}`
}

/** The link that opens the issue form with the report filled in. A description too long for the
 * link is cut short, and says so. */
export function newIssueUrl(report: ReportText): string {
  let url = formUrl(report)
  let description = report.description
  while (url.length > MAX_NEW_ISSUE_URL_LENGTH && description.length > 0) {
    // Each character removed shortens the encoded link by at least one, so this ends.
    const overflow = url.length - MAX_NEW_ISSUE_URL_LENGTH
    description = description.slice(
      0,
      Math.max(0, description.length - overflow - CUT_SHORT.length)
    )
    url = formUrl({ ...report, description: `${description.trimEnd()}${CUT_SHORT}` })
  }
  return url
}

export interface ReportFacts {
  status: ReportingStatus | null
  details: string | null
}

interface FactsSource {
  status(): Promise<ReportingStatus>
  details(): Promise<{ details: string }>
}

/** Whether gh can post, and the app details the report would carry: what both report screens
 * show before anything is sent. */
export async function loadReportFacts(source: FactsSource): Promise<ReportFacts> {
  const [status, { details }] = await Promise.all([source.status(), source.details()])
  return { status, details }
}
