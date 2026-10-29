import React, { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@terminator/extension-ui'
import './git-integration.css'
import { useGitStore, diffCacheKey } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { useResizePanel } from '../hooks/useResizePanel'
import { StagingArea } from './StagingArea'
import { FileDiffView } from './FileDiffView'
import { PrDialog } from './PrDialog'
import { PrCreatedNotice } from './PrCreatedNotice'
import type { FileDiff, PullRequest } from '../schemas/git.schema'
import { gitAPI, type CommitResult } from '../api/git'
import { MergeFlowView } from './merge-flow/MergeFlowView'
import { choose } from './text'
import { recordUsage } from '@terminator/extension-sdk/renderer'

interface Props {
  repoRoot: string | null
}

type CommitPhase = 'idle' | 'hooks' | 'committing'
type DiffAnswer = { diff: FileDiff } | { error: string }
type PrStatusAnswer = { pr: PullRequest | null } | { error: string }
type PushAnswer = { success: true } | { error: string }

const COMMIT_ERRORS: Record<string, string> = {
  NOTHING_TO_COMMIT: 'Nothing staged to commit. Stage at least one file first.',
  EMPTY_MESSAGE: 'Commit message cannot be empty.',
  TIMEOUT: 'Commit timed out — a pre-commit hook may have hung.',
  HOOK_FAILED: 'Pre-commit hooks failed.',
}

const PUSH_ERRORS: Record<string, string> = {
  NO_UPSTREAM: 'Committed but push failed — no upstream branch set.',
  REJECTED: 'Committed but push rejected — pull changes first.',
}

/** Runs `action` when the bridge broadcasts `event` for this repository, or for none in particular. */
function useBridgeTrigger(event: string, repoRoot: string | null, action: () => void): void {
  const actionRef = useRef(action)
  useEffect(() => {
    actionRef.current = action
  })
  useEffect(() => {
    return window.electronAPI.extensionBridge.on(event, (data) => {
      const { repoRoot: targetRoot } = (data ?? {}) as { repoRoot?: string }
      if (!targetRoot || targetRoot === repoRoot) actionRef.current()
    })
  }, [event, repoRoot])
}

/** What a Commit… or Create PR… command asked of this view. */
interface ViewRequest {
  kind: string
  repoRoot: string
}

interface PendingRequestTargets {
  commitMessageRef: React.RefObject<HTMLTextAreaElement>
  openPrDialog: () => void
}

/** A Commit… or Create PR… run before this view existed broadcast to nobody; the request waits
 *  in the backend for the view to collect it on mount. */
function usePendingViewRequest(repoRoot: string | null, targets: PendingRequestTargets): void {
  const { commitMessageRef, openPrDialog } = targets
  useEffect(() => {
    if (!repoRoot) return
    void window.electronAPI.extensionBridge
      .invoke('git:ui.consume-pending-request', {})
      .then((result) => {
        const request = (result as { request?: ViewRequest | null })?.request
        if (!request || request.repoRoot !== repoRoot) return
        if (request.kind === 'commit') commitMessageRef.current?.focus()
        else openPrDialog()
      })
      .catch(() => {})
  }, [repoRoot, commitMessageRef, openPrDialog])
}

interface DiffRequest {
  repoRoot: string
  path: string
  staged: boolean
  isUntracked: boolean
}

async function fetchDiff(req: DiffRequest): Promise<FileDiff | null> {
  const result = (await gitAPI.diffFile(req)) as DiffAnswer
  if ('diff' in result) return result.diff
  return null
}

function useDiffStore() {
  return useGitStore(
    useShallow((s) => ({
      status: s.status,
      selectedFile: s.selectedFile,
      diffCache: s.diffCache,
      setSelectedFile: s.setSelectedFile,
      setDiff: s.setDiff,
      setLoading: s.setLoading,
    }))
  )
}

/** The selected file's diff, read once per file and side and kept in the store's cache. */
function useFileDiff(repoRoot: string | null) {
  const { status, selectedFile, diffCache, setSelectedFile, setDiff, setLoading } = useDiffStore()
  const [selectedStaged, setSelectedStaged] = useState(false)
  const handleFileSelect = useCallback(
    async (path: string, staged: boolean) => {
      if (!repoRoot) return
      setSelectedFile(path)
      setSelectedStaged(staged)
      const cacheKey = diffCacheKey(path, staged)
      if (diffCache.has(cacheKey)) return
      setLoading(true)
      try {
        const isUntracked = status?.files.find((f) => f.path === path)?.status === 'untracked'
        const diff = await fetchDiff({ repoRoot, path, staged, isUntracked })
        if (diff) setDiff(cacheKey, diff)
      } finally {
        setLoading(false)
      }
    },
    [repoRoot, status, diffCache, setSelectedFile, setDiff, setLoading]
  )
  const cached = selectedFile && diffCache.get(diffCacheKey(selectedFile, selectedStaged))
  return { selectedDiff: cached || null, handleFileSelect }
}

/** The commit's progress: "hooks" while hook output streams in, "committing" after three quiet
 *  seconds. Hook output is polled every 300ms while a commit runs. */
function useCommitPhase() {
  const [commitPhase, setCommitPhase] = useState<CommitPhase>('idle')
  const [hookLines, setHookLines] = useState<string[]>([])
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const start = useCallback((root: string) => {
    const quietAfter = () => setTimeout(() => setCommitPhase('committing'), 3000)
    setCommitPhase('hooks')
    setHookLines([])
    phaseTimerRef.current = quietAfter()
    pollIntervalRef.current = setInterval(async () => {
      const { lines } = (await gitAPI.commitOutputPoll(root)) as { lines: string[] }
      if (lines.length === 0) return
      setCommitPhase('hooks')
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current)
        phaseTimerRef.current = quietAfter()
      }
      setHookLines((prev) => [...prev, ...lines])
    }, 300)
  }, [])
  const end = useCallback(() => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current)
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    setCommitPhase('idle')
  }, [])
  return { commitPhase, hookLines, setHookLines, start, end }
}

type CommitPhaseState = ReturnType<typeof useCommitPhase>

/** The last commit's failure: its message, the hook output, and whether a hook caused it. */
function useCommitError(phase: CommitPhaseState) {
  const [commitError, setCommitError] = useState<string | null>(null)
  const [hookOutput, setHookOutput] = useState<string | null>(null)
  const [isHookFailure, setIsHookFailure] = useState(false)
  const reset = useCallback(() => {
    setCommitError(null)
    setHookOutput(null)
    setIsHookFailure(false)
  }, [])
  const { setHookLines } = phase
  const show = useCallback((result: CommitResult) => {
    if (!('error' in result)) return
    setCommitError(COMMIT_ERRORS[result.error] ?? result.error)
    setHookOutput(result.hookOutput ?? null)
    setIsHookFailure(result.isHookFailure ?? false)
  }, [])
  const clearAfterCommit = useCallback(() => {
    reset()
    setHookLines([])
  }, [reset, setHookLines])
  return { commitError, setCommitError, hookOutput, isHookFailure, reset, show, clearAfterCommit }
}

type CommitErrorState = ReturnType<typeof useCommitError>

interface CommitRunner {
  repoRoot: string | null
  message: string
  canCommit: boolean
  phase: CommitPhaseState
  errors: CommitErrorState
  setIsCommitting: (v: boolean) => void
}

/** Commits the staged files; the commit's result, or null when there was nothing to commit. */
async function runCommit(r: CommitRunner, noVerify: boolean): Promise<CommitResult | null> {
  if (!r.canCommit || !r.repoRoot) return null
  r.setIsCommitting(true)
  r.errors.reset()
  r.phase.start(r.repoRoot)
  return gitAPI.commit({
    repoRoot: r.repoRoot,
    message: r.message.trim(),
    noVerify,
  })
}

async function pushAfterCommit(repoRoot: string, errors: CommitErrorState): Promise<void> {
  const pushResult = (await gitAPI.push(repoRoot)) as PushAnswer
  if ('error' in pushResult)
    errors.setCommitError(PUSH_ERRORS[pushResult.error] ?? pushResult.error)
}

interface CommitControls {
  runner: CommitRunner
  setCommitMessage: (message: string) => void
  setIsPushing: (v: boolean) => void
}

/** True when `runCommit` got as far as starting a commit. */
function commitStarted(r: CommitRunner): boolean {
  return r.canCommit && Boolean(r.repoRoot)
}

/** Shows a failed commit's error, or clears the box after a successful one; true on success. */
function applyCommitResult(c: CommitControls, result: CommitResult): boolean {
  recordUsage('commit', 'error' in result ? { failed: true } : {})
  if ('error' in result) {
    c.runner.errors.show(result)
    return false
  }
  c.setCommitMessage('')
  c.runner.errors.clearAfterCommit()
  return true
}

function finishCommit(c: CommitControls): void {
  c.runner.setIsCommitting(false)
  c.setIsPushing(false)
  c.runner.phase.end()
}

async function commitOnly(c: CommitControls, noVerify: boolean): Promise<void> {
  try {
    const result = await runCommit(c.runner, noVerify)
    if (result) applyCommitResult(c, result)
  } finally {
    if (commitStarted(c.runner)) finishCommit(c)
  }
}

async function commitAndPush(c: CommitControls, noVerify: boolean): Promise<void> {
  const { runner } = c
  try {
    const result = await runCommit(runner, noVerify)
    if (!result || !applyCommitResult(c, result) || !runner.repoRoot) return
    runner.setIsCommitting(false)
    runner.phase.end()
    c.setIsPushing(true)
    await pushAfterCommit(runner.repoRoot, runner.errors)
  } finally {
    if (commitStarted(runner)) finishCommit(c)
  }
}

function useCommitFlow(repoRoot: string | null, canCommitFiles: boolean) {
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const phase = useCommitPhase()
  const errors = useCommitError(phase)
  const canCommit = canCommitFiles && commitMessage.trim().length > 0
  const runner = { repoRoot, message: commitMessage, canCommit, phase, errors, setIsCommitting }
  const controls: CommitControls = { runner, setCommitMessage, setIsPushing }
  return {
    commitMessage,
    setCommitMessage,
    isCommitting,
    isPushing,
    canCommit,
    phase,
    errors,
    handleCommit: (noVerify = false) => commitOnly(controls, noVerify),
    handleCommitAndPush: (noVerify = false) => commitAndPush(controls, noVerify),
  }
}

type CommitFlow = ReturnType<typeof useCommitFlow>

function prOf(answer: PrStatusAnswer): PullRequest | null {
  if ('pr' in answer) return answer.pr
  return null
}

function usePrDialog(repoRoot: string | null) {
  const [showPrDialog, setShowPrDialog] = useState(false)
  const [existingPr, setExistingPr] = useState<PullRequest | null>(null)
  const handleOpenPr = useCallback(async () => {
    if (!repoRoot) return
    const prResult = (await gitAPI.prStatus(repoRoot)) as PrStatusAnswer
    setExistingPr(prOf(prResult))
    setShowPrDialog(true)
  }, [repoRoot])
  useBridgeTrigger('git:open-pr-dialog', repoRoot, handleOpenPr)
  const handlePrCreated = useCallback((pr: PullRequest) => {
    setShowPrDialog(false)
    window.dispatchEvent(new CustomEvent('git:pr-created', { detail: { pr } }))
  }, [])
  return { showPrDialog, setShowPrDialog, existingPr, handleOpenPr, handlePrCreated }
}

type PrDialogState = ReturnType<typeof usePrDialog>

function ConflictBanner({ onResolve }: { onResolve: () => void }) {
  return (
    <div className="git-full-view__conflict-banner">
      <span className="git-full-view__conflict-banner-text">Merge conflicts detected</span>
      <Button
        variant="danger"
        size="sm"
        icon={ArrowRight}
        className="git-full-view__conflict-banner-btn"
        onClick={onResolve}
      >
        Resolve conflicts
      </Button>
    </div>
  )
}

function CharCount({ count }: { count: number }) {
  if (count <= 50) return null
  const warn = choose(count > 72, ' git-view__char-count--warn', '')
  return <span className={`git-view__char-count${warn}`}>{count} chars</span>
}

function CommitError({ flow }: { flow: CommitFlow }) {
  const { commitError, hookOutput, isHookFailure } = flow.errors
  if (!commitError) return null
  return (
    <div className="git-view__commit-error">
      <span className="git-view__commit-error-msg">{commitError}</span>
      {hookOutput && (
        <details className="git-view__hook-output">
          <summary className="git-view__hook-output-summary">Hook output</summary>
          <pre className="git-view__hook-output-pre">{hookOutput}</pre>
        </details>
      )}
      {isHookFailure && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => flow.handleCommit(true)}
          disabled={flow.isCommitting || flow.isPushing}
        >
          Commit without hooks
        </Button>
      )}
    </div>
  )
}

const PHASE_TEXT: Record<CommitPhase, string | null> = {
  idle: null,
  hooks: '⟳ Running pre-commit hooks…',
  committing: '⟳ Committing…',
}

/** What the commit is doing: the hooks' live output, or the phase while there is none. */
function CommittingHint({ phase }: { phase: CommitPhaseState }) {
  if (phase.hookLines.length > 0) {
    return <pre className="git-view__hook-live">{phase.hookLines.join('\n')}</pre>
  }
  const text = PHASE_TEXT[phase.commitPhase]
  if (!text) return null
  return <span className="git-view__hint-text git-view__hint-text--status">{text}</span>
}

function idleHint(stagedCount: number, message: string): string | null {
  if (stagedCount === 0) return 'Stage at least one file to commit'
  if (!message.trim()) return 'Enter a commit message'
  return null
}

function CommitHint({ flow, stagedCount }: { flow: CommitFlow; stagedCount: number }) {
  const hint = idleHint(stagedCount, flow.commitMessage)
  return (
    <div className="git-view__commit-hint">
      {flow.isCommitting && <CommittingHint phase={flow.phase} />}
      {!flow.isCommitting && hint && <span className="git-view__hint-text">{hint}</span>}
    </div>
  )
}

function CommitButtons({ flow, onOpenPr }: { flow: CommitFlow; onOpenPr: () => void }) {
  const disabled = !flow.canCommit || flow.isCommitting || flow.isPushing
  return (
    <div className="git-view__buttons">
      <Button size="sm" onClick={onOpenPr}>
        Open PR
      </Button>
      <Button size="sm" onClick={() => flow.handleCommit(false)} disabled={disabled}>
        Commit
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={() => flow.handleCommitAndPush(false)}
        disabled={disabled}
      >
        {choose(flow.isPushing, 'Pushing…', 'Commit & Push')}
      </Button>
    </div>
  )
}

interface CommitSectionProps {
  repoRoot: string | null
  commitMessageRef: React.RefObject<HTMLTextAreaElement>
  flow: CommitFlow
  stagedCount: number
  onOpenPr: () => void
}

function CommitSection(props: CommitSectionProps) {
  const { flow, commitMessageRef } = props
  // Quick action "Commit…" (extensions/git-integration/src/commands.ts) brings this
  // view forward via api.window.showSelf, then broadcasts this to focus the box.
  useBridgeTrigger('git:focus-commit-message', props.repoRoot, () =>
    commitMessageRef.current?.focus()
  )
  return (
    <div className="git-full-view__commit-section">
      <textarea
        ref={commitMessageRef}
        className="git-view__commit-message"
        placeholder="Commit message…"
        value={flow.commitMessage}
        onChange={(e) => flow.setCommitMessage(e.target.value)}
        rows={3}
      />
      <CharCount count={flow.commitMessage.length} />
      <PrCreatedNotice />
      <CommitError flow={flow} />
      <div className="git-view__commit-actions">
        <CommitHint flow={flow} stagedCount={props.stagedCount} />
        <CommitButtons flow={flow} onOpenPr={props.onOpenPr} />
      </div>
    </div>
  )
}

interface ChangesPaneProps {
  repoRoot: string
  commitMessageRef: React.RefObject<HTMLTextAreaElement>
  width: number
  flow: CommitFlow
  pr: PrDialogState
  onFileSelect: (path: string, staged: boolean) => Promise<void>
}

function ChangesPane(props: ChangesPaneProps) {
  const { repoRoot, flow } = props
  const status = useGitStore((s) => s.status)
  const clearDiffCache = useGitStore((s) => s.clearDiffCache)
  const setView = useGitStore((s) => s.setView)
  const stagedCount = status?.files.filter((f) => f.staged).length ?? 0
  return (
    <div className="git-full-view__changes-pane" style={{ width: props.width }}>
      {status?.hasConflicts && <ConflictBanner onResolve={() => setView('merge-flow')} />}
      <div className="git-full-view__staging">
        <StagingArea
          repoRoot={repoRoot}
          onFileSelect={props.onFileSelect}
          onStagingChange={clearDiffCache}
        />
      </div>
      <CommitSection
        repoRoot={repoRoot}
        commitMessageRef={props.commitMessageRef}
        flow={flow}
        stagedCount={stagedCount}
        onOpenPr={props.pr.handleOpenPr}
      />
    </div>
  )
}

function OpenPrDialog({ repoRoot, pr }: { repoRoot: string; pr: PrDialogState }) {
  const status = useGitStore((s) => s.status)
  if (!pr.showPrDialog || !status) return null
  return (
    <PrDialog
      repoRoot={repoRoot}
      branch={status.branch}
      existingPr={pr.existingPr}
      onClose={() => pr.setShowPrDialog(false)}
      onCreated={pr.handlePrCreated}
    />
  )
}

function useGitFullView(repoRoot: string | null) {
  useGitStatus(repoRoot)
  const resize = useResizePanel(300, { min: 160, max: 600 }, -1)
  const { status, disabled, view, setView } = useGitStore(
    useShallow((s) => ({
      status: s.status,
      disabled: s.disabled,
      view: s.view,
      setView: s.setView,
    }))
  )
  const { selectedDiff, handleFileSelect } = useFileDiff(repoRoot)
  const flow = useCommitFlow(repoRoot, status?.files.some((f) => f.staged) ?? false)
  const pr = usePrDialog(repoRoot)
  const commitMessageRef = useRef<HTMLTextAreaElement>(null)
  usePendingViewRequest(repoRoot, { commitMessageRef, openPrDialog: pr.handleOpenPr })
  return {
    ...{ resize, disabled, view, setView, selectedDiff, handleFileSelect },
    ...{ flow, pr, commitMessageRef },
  }
}

/** What the view says instead of the changes: no project, or the workspace switched it off. */
function emptyNotice(repoRoot: string | null, disabled: boolean): string | null {
  if (!repoRoot) return 'No project selected.'
  return disabled ? 'Git Integration is off for this workspace.' : null
}

export function GitFullView({ repoRoot }: Props): JSX.Element {
  const g = useGitFullView(repoRoot)
  const notice = emptyNotice(repoRoot, g.disabled)
  if (notice !== null || !repoRoot) {
    return <div className="git-full-view git-full-view--empty">{notice}</div>
  }
  if (g.view === 'merge-flow') {
    return <MergeFlowView repoRoot={repoRoot} onExit={() => g.setView('default')} />
  }
  return (
    <div className="git-full-view">
      <div className="git-full-view__diff-pane">
        <FileDiffView diff={g.selectedDiff} />
      </div>
      <div className="git-resize-handle" onMouseDown={g.resize.handleMouseDown} />
      <ChangesPane
        repoRoot={repoRoot}
        commitMessageRef={g.commitMessageRef}
        width={g.resize.size}
        flow={g.flow}
        pr={g.pr}
        onFileSelect={g.handleFileSelect}
      />
      <OpenPrDialog repoRoot={repoRoot} pr={g.pr} />
    </div>
  )
}
