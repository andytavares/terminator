import React, { useState, useEffect } from 'react'
import { Dialog, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import type { PullRequest } from '../schemas/git.schema'
import { RichContent } from './pr-review/RichContent'
import { githubAPI } from '../api/github'

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

async function pushBranch(repoRoot: string): Promise<{ error: string } | null> {
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

async function checkCommitsAhead(
  repoRoot: string,
  base: string
): Promise<{ count: number } | { error: string }> {
  // Try local base branch first; fall back to origin/<base> if local doesn't exist
  for (const ref of [base, `origin/${base}`]) {
    const result = await window.electronAPI.shell.exec({
      command: 'git',
      args: ['rev-list', '--count', `${ref}..HEAD`],
      cwd: repoRoot,
    })
    if (!('error' in result) && result.exitCode === 0) {
      const count = parseInt(result.stdout.trim(), 10)
      return { count: isNaN(count) ? 0 : count }
    }
  }
  return { error: 'could not determine commit count' }
}

async function ghPrCreate(
  repoRoot: string,
  branch: string,
  title: string,
  body: string,
  base: string,
  isDraft: boolean,
  onStatus: (msg: string) => void
): Promise<{ pr: PullRequest } | { error: string }> {
  // Check for commits ahead before pushing — avoids a wasted push + cryptic GitHub error
  onStatus('Checking for commits…')
  const ahead = await checkCommitsAhead(repoRoot, base)
  if (!('error' in ahead) && ahead.count === 0) {
    return { error: `No commits ahead of "${base}". Commit your changes before opening a PR.` }
  }

  // Push the branch first so gh can find it on the remote
  onStatus('Pushing branch…')
  const pushErr = await pushBranch(repoRoot)
  if (pushErr) return pushErr

  onStatus('Creating pull request…')
  const result = await githubAPI.prCreate({
    repoRoot,
    title,
    body,
    base,
    head: branch,
    draft: isDraft,
  })
  if ('error' in result) return { error: result.error }
  const { number, url } = result
  return {
    pr: {
      number,
      title,
      body,
      url,
      state: 'open',
      isDraft,
      baseRefName: base,
      headRefName: branch,
    } as PullRequest,
  }
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

export function PrDialog({
  repoRoot,
  branch,
  existingPr,
  onClose,
  onCreated,
}: PrDialogProps): JSX.Element {
  const [title, setTitle] = useState(() =>
    branch.replace(/^(feat|fix|chore|docs|refactor)\//i, '').replace(/-/g, ' ')
  )
  const [body, setBody] = useState('')
  const [base, setBase] = useState('main')
  const [isDraft, setIsDraft] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [creatingStatus, setCreatingStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [descMode, setDescMode] = useState<DescriptionMode>('write')
  const [localBranches, setLocalBranches] = useState<Branch[]>([])
  const [remoteBranches, setRemoteBranches] = useState<Branch[]>([])
  const [baseFilter, setBaseFilter] = useState('')

  const isDefaultBranch = branch === 'main' || branch === 'master'

  useEffect(() => {
    void loadPrTemplate(repoRoot).then((template) => {
      if (template) setBody(template)
    })
    void window.electronAPI.git.listBranches(repoRoot).then((result) => {
      if (!('branches' in result)) return
      const others = result.branches.filter((b) => b.name !== branch)
      const local = others.filter((b) => !b.isRemote)
      const remote = others.filter((b) => b.isRemote)
      setLocalBranches(local)
      setRemoteBranches(remote)
      // Pick a sensible default base: prefer main/master among local branches
      const preferred = local.find((b) => b.name === 'main' || b.name === 'master')
      if (preferred) setBase(preferred.name)
      else if (local[0]) setBase(local[0].name)
    })
  }, [repoRoot, branch])

  const handleCreate = async (): Promise<void> => {
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setIsCreating(true)
    setCreatingStatus('')
    setError(null)
    try {
      const result = await ghPrCreate(
        repoRoot,
        branch,
        title.trim(),
        body,
        base,
        isDraft,
        setCreatingStatus
      )
      if ('error' in result) {
        setError(result.error)
      } else {
        onCreated(result.pr)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsCreating(false)
      setCreatingStatus('')
    }
  }

  const submitLabel = isCreating ? '…' : isDraft ? 'Create Draft PR' : 'Create PR'

  return (
    <Dialog
      title="Open Pull Request"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', disabled: isCreating, onSelect: onClose },
        {
          label: submitLabel,
          tone: 'primary',
          disabled: isCreating || !title.trim() || !!existingPr,
          onSelect: () => void handleCreate(),
        },
      ]}
    >
      {existingPr && (
        <div className="pr-dialog__existing-pr">
          A PR already exists:{' '}
          <a
            href={existingPr.url}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.shell.openExternal(existingPr.url).catch(() => {})
            }}
          >
            #{existingPr.number}: {existingPr.title}
          </a>
        </div>
      )}

      {isDefaultBranch && (
        <div className="pr-dialog__warning">
          Warning: creating a PR from the default branch ({branch}).
        </div>
      )}

      <div className="pr-dialog__field">
        <label className="pr-dialog__label">Title</label>
        <input
          className="pr-dialog__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Pull request title"
        />
      </div>

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
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your changes… (Markdown supported)"
              rows={8}
            />
          </TabPanel>
          <TabPanel id="preview">
            <RichContent className="pr-dialog__preview">{body || '*No description*'}</RichContent>
          </TabPanel>
        </div>
      </TabsRoot>

      <div className="pr-dialog__inline">
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
            value={base}
            onChange={(e) => setBase(e.target.value)}
            size={6}
          >
            <BranchGroup label="Local" branches={localBranches} filter={baseFilter} />
            <BranchGroup label="Remote" branches={remoteBranches} filter={baseFilter} />
          </select>
        </div>

        <label className="pr-dialog__draft-toggle">
          <input type="checkbox" checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} />
          Draft
        </label>
      </div>

      {error && <div className="pr-dialog__error">{error}</div>}

      {isCreating && creatingStatus && <p className="pr-dialog__status">{creatingStatus}</p>}
    </Dialog>
  )
}

/** One group of the base-branch list: the branches whose name contains `filter`. */
function BranchGroup({
  label,
  branches,
  filter,
}: {
  label: string
  branches: readonly { name: string }[]
  filter: string
}): JSX.Element | null {
  const shown = branches.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))
  if (shown.length === 0) return null
  return (
    <optgroup label={label}>
      {shown.map((b) => (
        <option key={b.name} value={b.name}>
          {b.name}
        </option>
      ))}
    </optgroup>
  )
}
