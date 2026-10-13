import React, { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import { mergeFlowAPI } from '../../api/merge-flow'
import { notificationsAPI } from '../../api/notifications'
import type { ConflictFile, ConflictSession } from '../../schemas/merge-flow.schema'
import { choose, plural, splitPath } from '../text'

interface Props {
  repoRoot: string
  onBack: () => void
  onExit: () => void
}

interface StrategyCount {
  mine: number
  theirs: number
  both: number
  manual: number
}

type StrategyKey = keyof StrategyCount

const STRATEGY_KEY = new Map<string, StrategyKey>([
  ['ours', 'mine'],
  ['theirs', 'theirs'],
  ['both-ours-first', 'both'],
  ['both-theirs-first', 'both'],
  ['manual', 'manual'],
])

function countStrategies(files: ConflictFile[]): StrategyCount {
  const counts = { mine: 0, theirs: 0, both: 0, manual: 0 }
  for (const block of files.flatMap((f) => f.blocks)) {
    const key = block.isResolved && STRATEGY_KEY.get(block.strategy ?? '')
    if (key) counts[key]++
  }
  return counts
}

/** Each strategy with its words and class, in the order the summary shows them. */
const STRATEGIES: { key: StrategyKey; tag: string; desc: string }[] = [
  { key: 'mine', tag: 'mine', desc: 'Kept yours' },
  { key: 'theirs', tag: 'theirs', desc: 'Kept theirs' },
  { key: 'both', tag: 'both', desc: 'Kept both' },
  { key: 'manual', tag: 'manual edit', desc: 'Manual edit' },
]

function fileStrategyCounts(file: ConflictFile): { label: string; cls: string; count: number }[] {
  const c = countStrategies([file])
  return STRATEGIES.filter((st) => c[st.key] > 0).map((st) => ({
    label: st.tag,
    cls: `strategy-tag--${st.key}`,
    count: c[st.key],
  }))
}

function formatDuration(startedAt: string): string {
  if (!startedAt) return ''
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'under a minute'
  return `${min} ${plural(min, 'minute')}`
}

const LANG_BADGES: Record<string, { label: string; bg: string }> = {
  ts: { label: 'TS', bg: '#2563eb' },
  tsx: { label: 'TS', bg: '#2563eb' },
  js: { label: 'JS', bg: '#ca8a04' },
  jsx: { label: 'JS', bg: '#ca8a04' },
  py: { label: 'PY', bg: '#3b82f6' },
  json: { label: '{ }', bg: '#0891b2' },
  css: { label: 'CSS', bg: '#db2777' },
  scss: { label: 'CSS', bg: '#db2777' },
  md: { label: 'MD', bg: '#6b7280' },
}

function getLangBadge(filePath: string): { label: string; bg: string } {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (Object.hasOwn(LANG_BADGES, ext)) return LANG_BADGES[ext]
  return { label: ext.slice(0, 3).toUpperCase() || '?', bg: '#4b5563' }
}

function defaultCommitMessage(session: ConflictSession | null): string {
  if (!session?.theirsBranch || !session.oursBranch) return 'Merge conflict resolution'
  const total = session.totalConflicts ?? 0
  return `Merge ${session.theirsBranch} into ${session.oursBranch} — resolve ${total} ${plural(total, 'conflict')}`
}

type Notice = Parameters<typeof notificationsAPI.notify>[0]

function notify(notice: Notice): void {
  void notificationsAPI.notify(notice)
}

/** Commits the resolved files; true once the session can be closed. */
async function commitMerge(
  repoRoot: string,
  session: ConflictSession,
  message: string
): Promise<boolean> {
  const resolvedPaths = session.files.map((f) => f.filePath)
  const result = await mergeFlowAPI.mergeCommit(repoRoot, resolvedPaths, message)
  if ('error' in result) {
    notify({ type: 'error', title: 'Commit failed', key: 'commitFailed', message: result.error })
    return false
  }
  if (result.pushError) {
    notify({
      type: 'warning',
      title: 'Committed but push failed',
      key: 'commitPushFailed',
      message: `Push manually: ${result.pushError}`,
    })
  }
  await mergeFlowAPI.clearSession(repoRoot)
  return true
}

function useMergeCommit(props: Props, session: ConflictSession | null) {
  const clearSession = useMergeFlowStore((s) => s.clearSession)
  const [commitMessage, setCommitMessage] = useState(defaultCommitMessage(session))
  const [isCommitting, setIsCommitting] = useState(false)
  const handleCommit = async () => {
    if (!session) return
    setIsCommitting(true)
    try {
      if (!(await commitMerge(props.repoRoot, session, commitMessage))) return
      clearSession()
      props.onExit()
    } catch (e) {
      notify({ type: 'error', title: 'Commit failed', key: 'commitFailed', message: String(e) })
    } finally {
      setIsCommitting(false)
    }
  }
  return { commitMessage, setCommitMessage, isCommitting, handleCommit }
}

type CommitState = ReturnType<typeof useMergeCommit>

function TopBar({ session }: { session: ConflictSession }) {
  const { oursBranch, theirsBranch } = session
  return (
    <div className="completion-screen__topbar">
      <div className="completion-screen__brand">
        <span className="completion-screen__brand-name">Conflict Solver</span>
      </div>
      {oursBranch && theirsBranch && (
        <div className="completion-screen__branch-crumb">
          <span className="completion-screen__branch">{oursBranch}</span>
          <ArrowRight aria-hidden="true" className="completion-screen__branch-arrow" />
          <span className="completion-screen__branch">{theirsBranch}</span>
        </div>
      )}
    </div>
  )
}

/** "You resolved 3 conflicts across 2 files in 4 minutes". */
function resolvedSummary(session: ConflictSession): string {
  const duration = formatDuration(session.startedAt)
  const total = session.totalConflicts
  const fileCount = session.files.length
  const across = `${fileCount} ${plural(fileCount, 'file')}`
  const took = choose(duration, ` in ${duration}`, '')
  return `You resolved ${total} ${plural(total, 'conflict')} across ${across}${took}`
}

function Headline({ session }: { session: ConflictSession }) {
  return (
    <>
      <div className="completion-screen__check-wrap">
        <div className="completion-screen__check">
          <Check aria-hidden="true" />
        </div>
      </div>
      <h2 className="completion-screen__title">All conflicts resolved</h2>
      <p className="completion-screen__subtitle">{resolvedSummary(session)}. Ready to commit.</p>
    </>
  )
}

function SummaryStats({ totals }: { totals: StrategyCount }) {
  return (
    <div className="completion-screen__summary-stats">
      {STRATEGIES.filter((st) => totals[st.key] > 0).map((st) => (
        <div key={st.key} className="completion-screen__summary-stat">
          <span
            className={`completion-screen__summary-num completion-screen__summary-num--${st.key}`}
          >
            {totals[st.key]}
          </span>
          <span className="completion-screen__summary-desc">{st.desc}</span>
        </div>
      ))}
    </div>
  )
}

function FileRow({ file }: { file: ConflictFile }) {
  const badge = getLangBadge(file.filePath)
  const { dir, name } = splitPath(file.filePath)
  return (
    <div className="completion-screen__file-row">
      <span className="completion-screen__file-badge" style={{ background: badge.bg }}>
        {badge.label}
      </span>
      <span className="completion-screen__file-path">
        <span className="completion-screen__file-dir">{dir}</span>
        <span className="completion-screen__file-name">{name}</span>
      </span>
      <div className="completion-screen__file-tags">
        {fileStrategyCounts(file).map((t) => (
          <span key={t.label} className={`strategy-tag ${t.cls}`}>
            {t.count}× {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ session }: { session: ConflictSession }) {
  return (
    <div className="completion-screen__card">
      <div className="completion-screen__card-label">Resolution summary</div>
      <SummaryStats totals={countStrategies(session.files)} />
      <div className="completion-screen__file-list">
        {session.files.map((file) => (
          <FileRow key={file.filePath} file={file} />
        ))}
      </div>
    </div>
  )
}

function CommitCard({ commit, onBack }: { commit: CommitState; onBack: () => void }) {
  const { commitMessage, isCommitting } = commit
  return (
    <div className="completion-screen__card">
      <div className="completion-screen__card-label">Commit message</div>
      <textarea
        className="completion-screen__commit-message"
        value={commitMessage}
        onChange={(e) => commit.setCommitMessage(e.target.value)}
        rows={2}
      />
      <div className="completion-screen__actions">
        <Button onClick={onBack}>Review changes</Button>
        <Button
          variant="primary"
          onClick={commit.handleCommit}
          disabled={isCommitting || !commitMessage.trim()}
        >
          {choose(isCommitting, 'Committing…', 'Commit merge')}
        </Button>
      </div>
    </div>
  )
}

export function CompletionScreen(props: Props) {
  const session = useMergeFlowStore((s) => s.session)
  const commit = useMergeCommit(props, session)
  if (!session) return null
  return (
    <div className="completion-screen">
      <TopBar session={session} />
      <div className="completion-screen__body">
        <Headline session={session} />
        <SummaryCard session={session} />
        <CommitCard commit={commit} onBack={props.onBack} />
        <p className="completion-screen__footer">
          Conflict history saved. You can undo individual decisions from the review view.
        </p>
      </div>
    </div>
  )
}
