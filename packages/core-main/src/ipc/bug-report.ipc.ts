import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { recordUsage } from '../extensions/extension-usage.js'
import type { RunCommand } from '../github/github-api.js'
import { fileIssue, reportingStatus } from '../bug-report/gh-report.js'
import type { ReportFile, ReportFiles } from '../bug-report/report-files.js'
import {
  attachmentKind,
  attachmentProblem,
  newIssueUrl,
  reportBody,
  type ReportText,
} from '../../../core-shared/src/bug-report.js'

/**
 * Reporting a bug as a public GitHub issue (ADR 156).
 *
 * Everything that reaches outside the process — running gh, capturing a window, the file picker,
 * opening the browser — comes in through `deps`, so the handlers are tested without Electron.
 */
export interface BugReportDeps {
  run: RunCommand
  /** Where gh runs. Any directory does: every call names the repository. */
  cwd: string
  files: Pick<ReportFiles, 'saveCapture' | 'add' | 'isGranted' | 'gather'>
  /** App and system versions, as the report carries them. */
  appDetails: () => string
  /** A PNG of the window the report was started from; null when there is none. */
  captureWindow: () => Promise<Buffer | null>
  /** A small data URL of an image, for the dialog; null when it cannot be drawn. */
  thumbnail: (path: string) => string | null
  pickFiles: () => Promise<string[]>
  openExternal: (url: string) => void
  showInFolder: (path: string) => void
  now: () => Date
}

const ReportSchema = z.object({
  title: z.string().trim().min(1).max(256),
  description: z.string().max(60_000),
  origin: z.string().max(200),
  includeDetails: z.boolean(),
  files: z.array(z.string().min(1)).max(20),
})

type ReportInput = z.infer<typeof ReportSchema>

const invalid = { ok: false, error: 'VALIDATION_ERROR', message: 'The report could not be read.' }

function attachmentOf(file: ReportFile, deps: BugReportDeps) {
  const kind = attachmentKind(file.name)
  return {
    ...file,
    kind,
    problem: attachmentProblem(file.name, file.bytes),
    thumbnail: kind === 'image' ? deps.thumbnail(file.path) : null,
  }
}

/** Why these files cannot go with the report, or null when they all can. */
async function filesProblem(paths: readonly string[], deps: BugReportDeps): Promise<string | null> {
  if (!paths.every((path) => deps.files.isGranted(path))) {
    return 'A file was not added through the report.'
  }
  const described = await deps.files.add(paths)
  return described.map((file) => attachmentProblem(file.name, file.bytes)).find(Boolean) ?? null
}

function reportText(input: ReportInput, deps: BugReportDeps): ReportText {
  return {
    title: input.title,
    description: input.description,
    origin: input.origin,
    details: input.includeDetails ? deps.appDetails() : null,
  }
}

async function submit(input: ReportInput, deps: BugReportDeps) {
  const problem = await filesProblem(input.files, deps)
  if (problem !== null) return { ok: false, error: 'VALIDATION_ERROR', message: problem }
  const filed = await fileIssue(deps.run, deps.cwd, {
    title: input.title,
    body: reportBody(reportText(input, deps)),
    files: input.files,
  })
  if (filed.ok) recordUsage({ feature: 'core.bug-report.post', via: 'click' })
  return filed
}

async function openInBrowser(input: ReportInput, deps: BugReportDeps) {
  const problem = await filesProblem(input.files, deps)
  if (problem !== null) return { ok: false, error: 'VALIDATION_ERROR', message: problem }
  if (input.files.length > 0) {
    const gathered = await deps.files.gather(input.files, deps.now())
    deps.showInFolder(gathered[0])
  }
  deps.openExternal(newIssueUrl(reportText(input, deps)))
  recordUsage({ feature: 'core.bug-report.browser', via: 'click' })
  return { ok: true }
}

async function pick(deps: BugReportDeps) {
  const added = await deps.files.add(await deps.pickFiles())
  return { attachments: added.map((file) => attachmentOf(file, deps)) }
}

async function capture(deps: BugReportDeps) {
  const png = await deps.captureWindow()
  if (png === null) {
    return { ok: false, error: 'CAPTURE_FAILED', message: 'There is no window to capture.' }
  }
  const file = await deps.files.saveCapture(png, deps.now())
  recordUsage({ feature: 'core.bug-report.capture', via: 'click' })
  return { ok: true, attachment: attachmentOf(file, deps) }
}

/** What the dialog asks before it posts: can gh post, the app details, and adding files. */
function preparationChannels(deps: BugReportDeps) {
  return [
    defineChannel({
      channel: 'bug-report:status',
      schema: noPayload,
      invalid,
      run: () => reportingStatus(deps.run, deps.cwd),
    }),
    defineChannel({
      channel: 'bug-report:details',
      schema: noPayload,
      invalid,
      run: () => ({ details: deps.appDetails() }),
    }),
    defineChannel({
      channel: 'bug-report:capture',
      schema: noPayload,
      invalid,
      run: () => capture(deps),
    }),
    defineChannel({
      channel: 'bug-report:pick',
      schema: noPayload,
      invalid,
      run: () => pick(deps),
    }),
  ]
}

/** Sending the report: through gh, or into the issue form in the browser. */
function sendingChannels(deps: BugReportDeps) {
  return [
    defineChannel({
      channel: 'bug-report:submit',
      schema: ReportSchema,
      invalid,
      run: (input) => submit(input, deps),
    }),
    defineChannel({
      channel: 'bug-report:open-in-browser',
      schema: ReportSchema,
      invalid,
      run: (input) => openInBrowser(input, deps),
    }),
  ]
}

export function registerBugReportHandlers(deps: BugReportDeps): void {
  registerInvokeTable([...preparationChannels(deps), ...sendingChannels(deps)])
}
