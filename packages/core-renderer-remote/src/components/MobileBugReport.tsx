import React, { useEffect, useState } from 'react'
import {
  ATTACHMENT_EXTENSIONS,
  attachmentProblem,
  newIssueUrl,
  loadReportFacts,
  type ReportFacts,
  type UploadedReport,
} from '../../../core-shared/src/bug-report'
import { readBase64 } from '../../../core-shared/src/read-base64'

// Report a bug from the phone (ADR 156). The desktop posts it through its own gh; without gh, the
// phone opens the filled-in GitHub form, where the photos and videos are attached by hand.

const ORIGIN = 'Phone remote'
/** Five files of up to 10 MB stay well inside the remote bridge's message limit. */
const MAX_FILES = 5

type Phase =
  | { name: 'editing' }
  | { name: 'posting' }
  | { name: 'posted'; number: number; url: string }
  | { name: 'failed'; message: string }

/** Whether the desktop's gh can post, and the app details the report would carry. */
function useFacts(): ReportFacts {
  const [facts, setFacts] = useState<ReportFacts>({ status: null, details: null })
  useEffect(() => void loadReportFacts(window.electronAPI.bugReport).then(setFacts), [])
  return facts
}

function problemsOf(files: File[]): string[] {
  const tooMany = files.length > MAX_FILES ? [`Up to ${MAX_FILES} files from the phone.`] : []
  const refused = files.map((file) => attachmentProblem(file.name, file.size))
  return [...tooMany, ...refused.filter((problem): problem is string => problem !== null)]
}

function useForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [includeDetails, setIncludeDetails] = useState(true)
  const [files, setFiles] = useState<File[]>([])
  const problems = problemsOf(files)
  const report = { title: title.trim(), description, origin: ORIGIN, includeDetails }
  const fields = { title, setTitle, description, setDescription, includeDetails, setIncludeDetails }
  return {
    ...fields,
    files,
    setFiles,
    problems,
    report,
    blocked: title.trim() === '' || problems.length > 0,
  }
}

type Form = ReturnType<typeof useForm>

async function post(form: Form, setPhase: (phase: Phase) => void): Promise<void> {
  setPhase({ name: 'posting' })
  const uploads = await Promise.all(
    form.files.map(async (file) => ({ name: file.name, data: await readBase64(file) }))
  )
  const report: UploadedReport = { ...form.report, uploads }
  const result = await window.electronAPI.bugReport.submitUploaded(report)
  setPhase(result.ok ? { name: 'posted', ...result } : { name: 'failed', message: result.message })
}

function TextFields({ form }: { form: Form }) {
  return (
    <>
      <label className="mobile-report__field">
        <span>Title</span>
        <input value={form.title} onChange={(e) => form.setTitle(e.target.value)} />
      </label>
      <label className="mobile-report__field">
        <span>What happened, and what you expected</span>
        <textarea
          rows={5}
          value={form.description}
          onChange={(e) => form.setDescription(e.target.value)}
        />
      </label>
    </>
  )
}

function FileField({ form }: { form: Form }) {
  return (
    <>
      <label className="mobile-report__field">
        <span>Photos or videos</span>
        <input
          type="file"
          multiple
          accept={ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
          onChange={(e) => form.setFiles([...(e.target.files ?? [])])}
        />
      </label>
      {form.problems.map((problem) => (
        <Problem key={problem} message={problem} />
      ))}
    </>
  )
}

function Problem({ message }: { message: string }) {
  return (
    <p className="mobile-report__problem" role="alert">
      {message}
    </p>
  )
}

function DetailsField({ form, details }: { form: Form; details: string | null }) {
  return (
    <>
      <label className="mobile-report__check">
        <input
          type="checkbox"
          checked={form.includeDetails}
          onChange={(e) => form.setIncludeDetails(e.target.checked)}
        />
        <span>Include app details</span>
      </label>
      {form.includeDetails && details !== null && (
        <pre className="mobile-report__details">{details}</pre>
      )}
    </>
  )
}

interface SendProps {
  form: Form
  facts: ReturnType<typeof useFacts>
  phase: Phase
  setPhase: (phase: Phase) => void
}

function Status({ children }: { children: React.ReactNode }) {
  return <p className="mobile-report__status">{children}</p>
}

/** The desktop cannot post: the phone opens GitHub's form, filled in, to attach files there. */
function OpenGitHub({ form, details }: { form: Form; details: string | null }) {
  const href = newIssueUrl({ ...form.report, details: form.includeDetails ? details : null })
  return (
    <>
      <Status>
        The desktop cannot post this report, so attach your photos and videos in GitHub’s form.
      </Status>
      <a className="mobile-report__send" href={href} target="_blank" rel="noreferrer">
        Open GitHub
      </a>
    </>
  )
}

function PostIssue({ form, phase, setPhase, login }: Omit<SendProps, 'facts'> & { login: string }) {
  return (
    <>
      <Status>Posting as @{login}</Status>
      {phase.name === 'failed' && <Problem message={phase.message} />}
      <button
        type="button"
        className="mobile-report__send"
        disabled={form.blocked}
        onClick={() => void post(form, setPhase)}
      >
        Post issue
      </button>
    </>
  )
}

function Send({ form, facts, phase, setPhase }: SendProps) {
  const { status, details } = facts
  if (phase.name === 'posting') return <Status>Posting to GitHub…</Status>
  if (status === null) return <Status>Checking the desktop’s GitHub CLI…</Status>
  if (!status.ready) return <OpenGitHub form={form} details={details} />
  return <PostIssue form={form} phase={phase} setPhase={setPhase} login={status.login} />
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <header className="mobile-terminal-header">
      <button type="button" onClick={onBack}>
        Back
      </button>
      <strong>Report a bug</strong>
    </header>
  )
}

export function MobileBugReport({ onBack }: { onBack: () => void }) {
  const facts = useFacts()
  const form = useForm()
  const [phase, setPhase] = useState<Phase>({ name: 'editing' })
  if (phase.name === 'posted') {
    return (
      <div className="mobile-report">
        <Header onBack={onBack} />
        <Status>
          <a href={phase.url} target="_blank" rel="noreferrer">
            Issue #{phase.number} posted
          </a>
        </Status>
      </div>
    )
  }
  return (
    <div className="mobile-report">
      <Header onBack={onBack} />
      <p className="mobile-report__public">
        This becomes a public issue on github.com/andytavares/terminator, posted as the desktop’s
        GitHub account.
      </p>
      <TextFields form={form} />
      <FileField form={form} />
      <DetailsField form={form} details={facts.details} />
      <Send form={form} facts={facts} phase={phase} setPhase={setPhase} />
    </div>
  )
}
