import React, { useState, useEffect } from 'react'
import { Dialog, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import type { PullRequest } from '../schemas/git.schema'
import { RichContent } from './pr-review/RichContent'
import { githubAPI } from '../api/github'
import { choose } from './text'
import { recordUsage } from '@terminator/extension-sdk/renderer'

interface Branch {
  name: string
  isCurrent: boolean
  isRemote: boolean
}

interface PrDialogProps {
  repoRoot: string
  branch: string
  existingPr: PullRequest | null
  onClose: () => void
  onCreated: (pr: PullRequest) => void
}

interface Failure {
  error: string
}

interface AheadCount {
  count: number
}

interface CreatedPr {
  pr: PullRequest
}

async function pushBeforePr(repoRoot: string): Promise<Failure | null> {
  const result = await window.electronAPI.shell.exec({
    command: 'git',
    args: ['push', '--set-upstream', 'origin', 'HEAD'],
    cwd: repoRoot,
    timeoutMs: 30000,
  })
  if ('error' in result) return { error: result.error }
  if (result.exitCode !== 0) return { error: result.stderr || 'git push failed' }
  return null
}

function countOrZero(stdout: string): number {
  const count = parseInt(stdout.trim(), 10)
  if (isNaN(count)) return 0
  return count
}

async function checkCommitsAhead(repoRoot: string, base: string): Promise<AheadCount | Failure> {
  // Try local base branch first; fall back to origin/<base> if local doesn't exist
  for (const ref of [base, `origin/${base}`]) {
    const result = await window.electronAPI.shell.exec({
      command: 'git',
      args: ['rev-list', '--count', `${ref}..HEAD`],
      cwd: repoRoot,
    })
    if (!('error' in result) && result.exitCode === 0) return { count: countOrZero(result.stdout) }
  }
  return { error: 'could not determine commit count' }
}

/** What the dialog asks GitHub to open. */
interface PrDraft {
  repoRoot: string
  branch: string
  title: string
  body: string
  base: string
  isDraft: boolean
}

/** Checks there is something to merge, then pushes the branch so gh can find it on the remote. */
async function prepareBranch(
  draft: PrDraft,
  onStatus: (msg: string) => void
): Promise<Failure | null> {
  onStatus('Checking for commits…')
  const ahead = await checkCommitsAhead(draft.repoRoot, draft.base)
  if (!('error' in ahead) && ahead.count === 0) {
    return {
      error: `No commits ahead of "${draft.base}". Commit your changes before opening a PR.`,
    }
  }
  onStatus('Pushing branch…')
  return pushBeforePr(draft.repoRoot)
}

async function ghPrCreate(
  draft: PrDraft,
  onStatus: (msg: string) => void
): Promise<CreatedPr | Failure> {
  const prepareError = await prepareBranch(draft, onStatus)
  if (prepareError) return prepareError
  onStatus('Creating pull request…')
  const { repoRoot, title, body, base, isDraft } = draft
  const result = await githubAPI.prCreate({
    repoRoot,
    title,
    body,
    base,
    head: draft.branch,
    draft: isDraft,
  })
  if ('error' in result) return { error: result.error }
  const { number, url } = result
  const pr = {
    number,
    title,
    body,
    url,
    state: 'open',
    isDraft,
    baseRefName: base,
    headRefName: draft.branch,
  }
  return { pr: pr as PullRequest }
}

type DescriptionMode = 'write' | 'preview'

const PR_TEMPLATE_PATHS = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
]

async function loadPrTemplate(repoRoot: string): Promise<string> {
  for (const relPath of PR_TEMPLATE_PATHS) {
    const result = await window.electronAPI.fs.readFile(`${repoRoot}/${relPath}`)
    if ('content' in result) return result.content
  }
  return ''
}

/** "feat/add-login" becomes "add login". */
function titleFromBranch(branch: string): string {
  return branch
    .replace(new RegExp('^(feat|fix|chore|docs|refactor)/', 'i'), '')
    .replaceAll('-', ' ')
}

/** Prefer main or master among local branches, else the first one. */
function defaultBase(local: Branch[]): string | undefined {
  const preferred = local.find((b) => b.name === 'main' || b.name === 'master')
  return (preferred ?? local[0])?.name
}

/** The repository's other branches, its PR template, and a sensible base. */
function useBranchChoices(props: PrDialogProps, setBody: (body: string) => void) {
  const { repoRoot, branch } = props
  const [base, setBase] = useState('main')
  const [localBranches, setLocalBranches] = useState<Branch[]>([])
  const [remoteBranches, setRemoteBranches] = useState<Branch[]>([])
  useEffect(() => {
    void loadPrTemplate(repoRoot).then((template) => {
      if (template) setBody(template)
    })
    void window.electronAPI.git.listBranches(repoRoot).then((result) => {
      if (!('branches' in result)) return
      const others = result.branches.filter((b) => b.name !== branch)
      const local = others.filter((b) => !b.isRemote)
      setLocalBranches(local)
      setRemoteBranches(others.filter((b) => b.isRemote))
      const picked = defaultBase(local)
      if (picked) setBase(picked)
    })
  }, [repoRoot, branch, setBody])
  return { base, setBase, localBranches, remoteBranches }
}

function usePrForm(props: PrDialogProps) {
  const [title, setTitle] = useState(() => titleFromBranch(props.branch))
  const [body, setBody] = useState('')
  const [isDraft, setIsDraft] = useState(false)
  const branches = useBranchChoices(props, setBody)
  return { title, setTitle, body, setBody, isDraft, setIsDraft, ...branches }
}

type PrForm = ReturnType<typeof usePrForm>

function draftOf(props: PrDialogProps, form: PrForm): PrDraft {
  return {
    repoRoot: props.repoRoot,
    branch: props.branch,
    title: form.title.trim(),
    body: form.body,
    base: form.base,
    isDraft: form.isDraft,
  }
}

function usePrCreate(props: PrDialogProps, form: PrForm) {
  const [isCreating, setIsCreating] = useState(false)
  const [creatingStatus, setCreatingStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const handleCreate = async (): Promise<void> => {
    if (!form.title.trim()) return setError('Title is required')
    setIsCreating(true)
    setCreatingStatus('')
    setError(null)
    try {
      const result = await ghPrCreate(draftOf(props, form), setCreatingStatus)
      recordUsage('pr-create', 'error' in result ? { failed: true } : {})
      if ('error' in result) setError(result.error)
      else props.onCreated(result.pr)
    } catch (err) {
      recordUsage('pr-create', { failed: true })
      setError(String(err))
    } finally {
      setIsCreating(false)
      setCreatingStatus('')
    }
  }
  return { isCreating, creatingStatus, error, handleCreate }
}

type PrCreate = ReturnType<typeof usePrCreate>

function submitLabel(isCreating: boolean, isDraft: boolean): string {
  if (isCreating) return '…'
  return choose(isDraft, 'Create Draft PR', 'Create PR')
}

function prDialogActions(props: PrDialogProps, form: PrForm, create: PrCreate) {
  const { isCreating } = create
  return [
    { label: 'Cancel', disabled: isCreating, onSelect: props.onClose },
    {
      label: submitLabel(isCreating, form.isDraft),
      tone: 'primary' as const,
      disabled: isCreating || !form.title.trim() || !!props.existingPr,
      onSelect: () => void create.handleCreate(),
    },
  ]
}

function ExistingPr({ pr }: { pr: PullRequest }) {
  return (
    <div className="pr-dialog__existing-pr">
      A PR already exists:{' '}
      <a
        href={pr.url}
        onClick={(e) => {
          e.preventDefault()
          window.electronAPI.shell.openExternal(pr.url).catch(() => {})
        }}
      >
        #{pr.number}: {pr.title}
      </a>
    </div>
  )
}

function TitleField({ form }: { form: PrForm }) {
  return (
    <div className="pr-dialog__field">
      <label className="pr-dialog__label">Title</label>
      <input
        className="pr-dialog__input"
        value={form.title}
        onChange={(e) => form.setTitle(e.target.value)}
        placeholder="Pull request title"
      />
    </div>
  )
}

function DescriptionField({ form }: { form: PrForm }) {
  const [descMode, setDescMode] = useState<DescriptionMode>('write')
  return (
    <TabsRoot selectedId={descMode} onSelect={setDescMode}>
      <div className="pr-dialog__field">
        <div className="pr-dialog__inline pr-dialog__desc-header">
          <label className="pr-dialog__label">Description</label>
          <TabList label="Description">
            <Tab id="write">Write</Tab>
            <Tab id="preview">Preview</Tab>
          </TabList>
        </div>
        <TabPanel id="write">
          <textarea
            className="pr-dialog__textarea"
            value={form.body}
            onChange={(e) => form.setBody(e.target.value)}
            placeholder="Describe your changes… (Markdown supported)"
            rows={8}
          />
        </TabPanel>
        <TabPanel id="preview">
          <RichContent className="pr-dialog__preview">
            {form.body || '*No description*'}
          </RichContent>
        </TabPanel>
      </div>
    </TabsRoot>
  )
}

function BranchGroup({ label, branches }: { label: string; branches: Branch[] }) {
  if (branches.length === 0) return null
  return (
    <optgroup label={label}>
      {branches.map((b) => (
        <option key={b.name} value={b.name}>
          {b.name}
        </option>
      ))}
    </optgroup>
  )
}

function BaseField({ form }: { form: PrForm }) {
  const [baseFilter, setBaseFilter] = useState('')
  const matchesBaseFilter = (b: Branch) => b.name.toLowerCase().includes(baseFilter.toLowerCase())
  return (
    <div className="pr-dialog__field pr-dialog__field--flex">
      <label className="pr-dialog__label">Base branch</label>
      <input
        className="pr-dialog__input"
        placeholder="Filter branches…"
        value={baseFilter}
        onChange={(e) => setBaseFilter(e.target.value)}
        style={{ marginBottom: 4 }}
      />
      <select
        className="pr-dialog__input pr-dialog__select"
        value={form.base}
        onChange={(e) => form.setBase(e.target.value)}
        size={6}
      >
        <BranchGroup label="Local" branches={form.localBranches.filter(matchesBaseFilter)} />
        <BranchGroup label="Remote" branches={form.remoteBranches.filter(matchesBaseFilter)} />
      </select>
    </div>
  )
}

function BaseAndDraft({ form }: { form: PrForm }) {
  return (
    <div className="pr-dialog__inline">
      <BaseField form={form} />
      <label className="pr-dialog__draft-toggle">
        <input
          type="checkbox"
          checked={form.isDraft}
          onChange={(e) => form.setIsDraft(e.target.checked)}
        />
        Draft
      </label>
    </div>
  )
}

export function PrDialog(props: PrDialogProps): JSX.Element {
  const { branch, existingPr } = props
  const form = usePrForm(props)
  const create = usePrCreate(props, form)
  const isDefaultBranch = branch === 'main' || branch === 'master'
  return (
    <Dialog
      title="Open Pull Request"
      onDismiss={props.onClose}
      actions={prDialogActions(props, form, create)}
    >
      {existingPr && <ExistingPr pr={existingPr} />}
      {isDefaultBranch && (
        <div className="pr-dialog__warning">
          Warning: creating a PR from the default branch ({branch}).
        </div>
      )}
      <TitleField form={form} />
      <DescriptionField form={form} />
      <BaseAndDraft form={form} />
      {create.error && <div className="pr-dialog__error">{create.error}</div>}
      {create.isCreating && create.creatingStatus && (
        <p className="pr-dialog__status">{create.creatingStatus}</p>
      )}
    </Dialog>
  )
}
