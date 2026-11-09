import { useCallback, useEffect, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Camera, Globe, Paperclip, Video, X } from 'lucide-react'
import { Checkbox, Dialog, type DialogAction } from '@terminator/extension-ui'
import {
  loadReportFacts,
  type ReportAttachment,
  type ReportFacts,
  type ReportingStatus,
  type ReportSubmission,
} from '../../../core-shared/src/bug-report'
import { useBugReportStore, type ReportPhase } from '../stores/bug-report.store'
import { recordUse } from '../usage/record'
import './BugReportDialog.css'

// Report a bug (ADR 156): a public GitHub issue, posted through the user's gh, or finished in the
// browser when gh cannot post it.

const NOT_READY: Record<Extract<ReportingStatus, { ready: false }>['reason'], string> = {
  'no-gh': 'GitHub CLI (gh) is not installed, so this report finishes in your browser.',
  'no-attach': 'This version of gh cannot attach files. Update gh, or finish in your browser.',
  'signed-out':
    'gh is not signed in to GitHub. Run gh auth login in a terminal, or finish in your browser.',
}

/** Whether gh can post, and the app details the report would carry. */
function useReportFacts(): ReportFacts {
  const [facts, setFacts] = useState<ReportFacts>({ status: null, details: null })
  useEffect(() => void loadReportFacts(window.electronAPI.bugReport).then(setFacts), [])
  return facts
}

/** The report as typed so far, and its files. */
function useReportForm(prefill: string) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState(prefill)
  const [includeDetails, setIncludeDetails] = useState(true)
  const [attachments, setAttachments] = useState<ReportAttachment[]>([])
  const add = useCallback((added: ReportAttachment[]) => {
    setAttachments((now) => [...now, ...added.filter((a) => !now.some((b) => b.path === a.path))])
  }, [])
  const remove = (path: string) => setAttachments((now) => now.filter((a) => a.path !== path))
  const blocked = title.trim() === '' || attachments.some((a) => a.problem !== null)
  const submission = (origin: string): ReportSubmission => ({
    title: title.trim(),
    description,
    origin,
    includeDetails,
    files: attachments.map((a) => a.path),
  })
  const fields = { title, setTitle, description, setDescription, includeDetails, setIncludeDetails }
  return { ...fields, attachments, add, remove, blocked, submission }
}

type ReportForm = ReturnType<typeof useReportForm>

/** Two frames, so the dialog is gone from the screen before the window is captured. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

/** Capture window and Add files, with the dialog hidden while the window is captured. */
function useAddingFiles(form: ReportForm) {
  const [capturing, setCapturing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const capture = async () => {
    setCapturing(true)
    await nextPaint()
    const result = await window.electronAPI.bugReport.capture()
    setCapturing(false)
    if (result.ok) form.add([result.attachment])
    setProblem(result.ok ? null : result.message)
  }
  const pick = async () => form.add((await window.electronAPI.bugReport.pick()).attachments)
  return { capturing, problem, capture, pick }
}

interface ActionInputs {
  phase: ReportPhase
  status: ReportingStatus | null
  form: ReportForm
  report: ReportSubmission
  close: () => void
}

function sendActions({ phase, status, form, report, close }: ActionInputs): DialogAction[] {
  const { post, finishInBrowser } = useBugReportStore.getState()
  const browser: DialogAction = {
    label: 'Continue in browser',
    disabled: form.title.trim() === '',
    onSelect: () => finishInBrowser(report),
  }
  if (!status?.ready)
    return [
      { label: 'Cancel', onSelect: close },
      { ...browser, tone: 'primary' },
    ]
  const postIssue: DialogAction = {
    label: 'Post issue',
    tone: 'primary',
    disabled: form.blocked,
    onSelect: () => post(report),
  }
  const cancel = { label: 'Cancel', onSelect: close }
  return phase.name === 'failed' ? [cancel, browser, postIssue] : [cancel, postIssue]
}

function dialogActions(inputs: ActionInputs): DialogAction[] {
  const { phase, close } = inputs
  if (phase.name === 'posting') return [{ label: 'Hide', onSelect: close }]
  if (phase.name === 'in-browser') return [{ label: 'Done', tone: 'primary', onSelect: close }]
  if (phase.name === 'posted') {
    const open = () => void window.electronAPI.shell.openExternal(phase.url)
    return [
      { label: 'Close', onSelect: close },
      { label: 'Open on GitHub', tone: 'primary', onSelect: open },
    ]
  }
  return sendActions(inputs)
}

function AttachmentTile({ file, onRemove }: { file: ReportAttachment; onRemove: () => void }) {
  return (
    <li className="bug-report__tile" data-problem={file.problem !== null}>
      {file.thumbnail ? (
        <img src={file.thumbnail} alt={file.name} />
      ) : (
        <span className="bug-report__video" aria-hidden="true">
          <Video />
        </span>
      )}
      <span className="bug-report__tile-name">{file.name}</span>
      <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove}>
        <X aria-hidden="true" />
      </button>
    </li>
  )
}

type AddingFiles = ReturnType<typeof useAddingFiles>

function Attachments({ form, adding }: { form: ReportForm; adding: AddingFiles }) {
  const problems = [adding.problem, ...form.attachments.map((a) => a.problem)].filter(Boolean)
  return (
    <fieldset className="bug-report__attachments">
      <legend>Images and videos, up to 10 MB each</legend>
      {form.attachments.length > 0 && (
        <ul className="bug-report__tiles">
          {form.attachments.map((file) => (
            <AttachmentTile key={file.path} file={file} onRemove={() => form.remove(file.path)} />
          ))}
        </ul>
      )}
      {problems.map((problem) => (
        <p key={problem} className="bug-report__problem" role="alert">
          {problem}
        </p>
      ))}
      <div className="bug-report__add">
        <button type="button" onClick={() => void adding.capture()} disabled={adding.capturing}>
          <Camera aria-hidden="true" /> Capture window
        </button>
        <button type="button" onClick={() => void adding.pick()}>
          <Paperclip aria-hidden="true" /> Add files
        </button>
      </div>
    </fieldset>
  )
}

function AppDetails({ form, details }: { form: ReportForm; details: string | null }) {
  return (
    <div className="bug-report__details">
      <Checkbox
        label="Include app details"
        checked={form.includeDetails}
        onChange={form.setIncludeDetails}
      />
      <div>
        <span>Include app details</span>
        {form.includeDetails && details !== null && <pre>{details}</pre>}
      </div>
    </div>
  )
}

function StatusLine({ status, phase }: { status: ReportingStatus | null; phase: ReportPhase }) {
  if (phase.name === 'posting') return <p className="bug-report__status">Posting to GitHub…</p>
  if (phase.name === 'failed') {
    return (
      <p className="bug-report__problem" role="alert">
        {phase.message}
      </p>
    )
  }
  if (status === null) return <p className="bug-report__status">Checking GitHub CLI…</p>
  if (status.ready) return <p className="bug-report__status">Posting as @{status.login}</p>
  return <p className="bug-report__status">{NOT_READY[status.reason]}</p>
}

function TextFields({ form, disabled }: { form: ReportForm; disabled: boolean }) {
  return (
    <>
      <label className="bug-report__field">
        <span>Title</span>
        <input
          type="text"
          value={form.title}
          disabled={disabled}
          onChange={(e) => form.setTitle(e.target.value)}
        />
      </label>
      <label className="bug-report__field">
        <span>What happened, and what you expected</span>
        <textarea
          rows={5}
          value={form.description}
          disabled={disabled}
          onChange={(e) => form.setDescription(e.target.value)}
        />
      </label>
    </>
  )
}

interface FormProps {
  form: ReportForm
  adding: AddingFiles
  origin: string
  facts: ReturnType<typeof useReportFacts>
  phase: ReportPhase
}

function ReportFormBody({ form, adding, origin, facts, phase }: FormProps) {
  return (
    <div className="bug-report">
      <p className="bug-report__public">
        <Globe aria-hidden="true" />
        <span>
          This becomes a public issue on github.com/andytavares/terminator. Check screenshots for
          tokens or private paths.
        </span>
      </p>
      <span className="bug-report__origin">from: {origin}</span>
      <TextFields form={form} disabled={phase.name === 'posting'} />
      <Attachments form={form} adding={adding} />
      <AppDetails form={form} details={facts.details} />
      <StatusLine status={facts.status} phase={phase} />
    </div>
  )
}

function Outcome({ phase }: { phase: ReportPhase }) {
  if (phase.name === 'posted') {
    return <p className="bug-report__outcome">Issue #{phase.number} posted</p>
  }
  return (
    <p className="bug-report__outcome">
      The issue form is open in your browser. Drag the files from the Finder window into it, then
      press Create.
    </p>
  )
}

function BugReportDialog(): JSX.Element | null {
  const { origin, prefill, phase, close } = useBugReportStore(
    useShallow((s) => ({ origin: s.origin, prefill: s.prefill, phase: s.phase, close: s.close }))
  )
  const facts = useReportFacts()
  const form = useReportForm(prefill)
  const adding = useAddingFiles(form)
  useEffect(() => recordUse('core.bug-report', 'shown'), [])
  // Off the screen while the window is captured; the form keeps its state.
  if (adding.capturing) return null
  const report = form.submission(origin)
  const done = phase.name === 'posted' || phase.name === 'in-browser'
  return (
    <Dialog
      title="Report a bug"
      size="wide"
      onDismiss={close}
      actions={dialogActions({ phase, status: facts.status, form, report, close })}
    >
      {done ? (
        <Outcome phase={phase} />
      ) : (
        <ReportFormBody {...{ form, adding, origin, facts, phase }} />
      )}
    </Dialog>
  )
}

/** The bug report dialog while the store says it is open. */
export function BugReportHost(): JSX.Element | null {
  const isOpen = useBugReportStore((s) => s.isOpen)
  return isOpen ? <BugReportDialog /> : null
}
