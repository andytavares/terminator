import { AlertTriangle, ListFilter } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { githubAPI } from '../../api/github'
import { DashboardPRSchema, type DashboardPR } from '../../schemas/pr-review.schema'
import { DiffSize } from './DiffSize'
import { RepoPicker } from './RepoPicker'
import './review-dashboard.css'

type Tab = 'needs' | 'mine' | 'involved'

const FOCUS_REFRESH_MS = 2 * 60 * 1000
const TICK_MS = 60 * 1000

const SECTIONS = ['re-review', 'requested', 'team', 'mine', 'involved'] as const

const SECTION_LABEL: Record<(typeof SECTIONS)[number], string> = {
  're-review': 'Re-review',
  requested: 'Requested',
  team: 'Team',
  mine: 'My PRs',
  involved: 'Involved',
}

const FailedSectionSchema = z.object({ section: z.enum(SECTIONS), error: z.string() })

const DashboardResultSchema = z.union([
  z.object({
    prs: z.array(DashboardPRSchema),
    login: z.string(),
    fetchedAt: z.string(),
    failed: z.array(FailedSectionSchema).optional(),
    scopedTo: z.number().optional(),
  }),
  z.object({ error: z.string() }),
])

type DashboardResult = z.infer<typeof DashboardResultSchema>
type FailedSection = z.infer<typeof FailedSectionSchema>

/** The command that failed carries the whole GraphQL query; the reader needs only gh's own line. */
export function shortError(message: string): string {
  const at = message.lastIndexOf('gh:')
  if (at >= 0) return message.slice(at).split('\n')[0].trim()
  const lines = message.split('\n').filter((l) => l.trim())
  return (lines[lines.length - 1] ?? message).trim()
}

function failedSummary(failed: FailedSection[]): string {
  const names = failed.map((f) => SECTION_LABEL[f.section]).join(', ')
  const reasons = [...new Set(failed.map((f) => shortError(f.error)))].join('; ')
  return `Couldn't load ${names}: ${reasons}.`
}

async function fetchDashboard(): Promise<DashboardResult> {
  const raw = await githubAPI.dashboardSearch()
  return DashboardResultSchema.parse(raw)
}

async function fetchSettings(): Promise<{ cloneFolder: string; repos: string[] }> {
  try {
    const raw = (await githubAPI.reviewSettings()) as {
      cloneFolder?: unknown
      repos?: unknown
    } | null
    return {
      cloneFolder: typeof raw?.cloneFolder === 'string' ? raw.cloneFolder : '',
      repos: Array.isArray(raw?.repos) ? (raw.repos as string[]) : [],
    }
  } catch {
    return { cloneFolder: '', repos: [] }
  }
}

function repoRootFor(pr: DashboardPR): string {
  return pr.localRepoRoot ?? `gh:${pr.repo}`
}

const REVIEW_CLOSENESS: Record<DashboardPR['reviewDecision'], number> = {
  approved: 0,
  'review-required': 1,
  'changes-requested': 2,
  none: 3,
}

function sortByCloseness(prs: DashboardPR[]): DashboardPR[] {
  return [...prs].sort((a, b) => {
    const closeness = REVIEW_CLOSENESS[a.reviewDecision] - REVIEW_CLOSENESS[b.reviewDecision]
    if (closeness !== 0) return closeness
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

function sortByOldest(prs: DashboardPR[]): DashboardPR[] {
  return [...prs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function daysAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.max(0, Math.floor(ms / 86400000))
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

function ciLabel(pr: DashboardPR): string {
  return pr.ciStatus === 'none' ? 'CI pending' : `CI ${pr.ciStatus}`
}

function reReviewSubline(pr: DashboardPR): string {
  const reviewers = pr.reviewerCount > 1 ? ` · you are 1 of ${pr.reviewerCount} reviewers` : ''
  return `${pr.commitsSinceMyReview} commits since your review${reviewers}`
}

function requestedSubline(pr: DashboardPR): string {
  const reviewers = pr.reviewerCount > 1 ? ` · you are 1 of ${pr.reviewerCount} reviewers` : ''
  return `${ciLabel(pr)} · opened ${daysAgo(pr.createdAt)}${reviewers}`
}

function mineSubline(pr: DashboardPR): string {
  if (pr.reviewDecision === 'changes-requested') {
    return `Changes requested · ${pr.unresolvedThreads} unresolved thread${pr.unresolvedThreads === 1 ? '' : 's'}`
  }
  if (pr.reviewDecision === 'approved') {
    return 'Approved · ready to merge'
  }
  return `${ciLabel(pr)} · opened ${daysAgo(pr.createdAt)}`
}

function involvedSubline(pr: DashboardPR): string {
  return `${ciLabel(pr)} · opened ${daysAgo(pr.createdAt)}`
}

function riskChip(pr: DashboardPR): { text: string; cls: string } {
  if (pr.riskLevel === 'high') return { text: 'High risk', cls: 'rd-hi' }
  if (pr.riskLevel === 'medium') return { text: 'Medium risk', cls: 'rd-md' }
  return { text: 'Low risk', cls: 'rd-lo' }
}

function blockerChip(pr: DashboardPR): { text: string; cls: string } {
  if (pr.reviewDecision === 'changes-requested') return { text: 'Changes asked', cls: 'rd-md' }
  if (pr.ciStatus === 'failing') return { text: 'CI failing', cls: 'rd-hi' }
  if (pr.reviewDecision === 'approved') return { text: 'Approved', cls: 'rd-lo' }
  return { text: 'Waiting', cls: '' }
}

function repoName(repo: string): string {
  return repo.split('/').pop() ?? repo
}

function withClonedNote(subline: string, pr: DashboardPR): string {
  return pr.localRepoRoot ? subline : `${subline} · Not cloned · diff only`
}

interface RowConfig {
  pr: DashboardPR
  subline: string
  chip: { text: string; cls: string }
  estimate: string
  buttonLabel: string
  primary: boolean
}

interface CloneState {
  status: 'cloning' | 'error'
  message?: string
}

function Row({
  cfg,
  onOpen,
  cloneFolder,
  cloneState,
  onClone,
}: {
  cfg: RowConfig
  onOpen: (pr: DashboardPR) => void
  cloneFolder: string
  cloneState?: CloneState
  onClone: (pr: DashboardPR) => void
}): JSX.Element {
  const { pr, subline, chip, estimate, buttonLabel, primary } = cfg
  const handle = () => onOpen(pr)
  const showClone = !pr.localRepoRoot && !!cloneFolder
  return (
    <div
      className="rd-row"
      tabIndex={0}
      data-testid={`row-${pr.number}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handle()
      }}
    >
      <span className="rd-chip rd-repo">{repoName(pr.repo)}</span>
      <span className="rd-ti">
        #{pr.number} {pr.title}
        <small>{subline}</small>
      </span>
      <DiffSize additions={pr.additions} deletions={pr.deletions} fileCount={pr.fileCount} />
      <span>{chip.text && <span className={`rd-chip ${chip.cls}`}>{chip.text}</span>}</span>
      <span className="rd-num">{estimate}</span>
      <span className="rd-actions">
        <button type="button" className={primary ? 'rd-btn rd-pri' : 'rd-btn'} onClick={handle}>
          {buttonLabel}
        </button>
        {showClone && (
          <button
            type="button"
            className="rd-btn"
            disabled={cloneState?.status === 'cloning'}
            onClick={() => onClone(pr)}
          >
            {cloneState?.status === 'cloning' ? 'Cloning…' : 'Clone and review'}
          </button>
        )}
        {cloneState?.status === 'error' && (
          <span className="rd-clone-error">{cloneState.message}</span>
        )}
      </span>
    </div>
  )
}

function toNeedsRow(pr: DashboardPR): RowConfig {
  const isReReview = pr.section === 're-review'
  return {
    pr,
    subline: withClonedNote(isReReview ? reReviewSubline(pr) : requestedSubline(pr), pr),
    chip: riskChip(pr),
    estimate: `~${pr.estimatedMinutes} min`,
    buttonLabel: isReReview ? 'Re-review' : 'Review',
    primary: isReReview,
  }
}

function toMineRow(pr: DashboardPR): RowConfig {
  return {
    pr,
    subline: withClonedNote(mineSubline(pr), pr),
    chip: blockerChip(pr),
    estimate: ciLabel(pr),
    buttonLabel: 'Open',
    primary: false,
  }
}

function toInvolvedRow(pr: DashboardPR): RowConfig {
  return {
    pr,
    subline: withClonedNote(involvedSubline(pr), pr),
    chip: riskChip(pr),
    estimate: `~${pr.estimatedMinutes} min`,
    buttonLabel: 'Open',
    primary: false,
  }
}

export function ReviewDashboard(): JSX.Element {
  const [prs, setPrs] = useState<DashboardPR[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('needs')
  const [, setTick] = useState(0)
  const [cloneFolder, setCloneFolder] = useState('')
  const [failed, setFailed] = useState<FailedSection[]>([])
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [scopedTo, setScopedTo] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cloneStatus, setCloneStatus] = useState<Record<number, CloneState>>({})
  const lastFetchRef = useRef<number>(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchDashboard()
      if ('error' in result) {
        setError(shortError(result.error))
      } else if ((result.failed?.length ?? 0) >= SECTIONS.length) {
        setError(shortError(result.failed![0].error))
        setFailed([])
      } else {
        setPrs(result.prs)
        setFailed(result.failed ?? [])
        setScopedTo(result.scopedTo ?? 0)
        setFetchedAt(new Date(result.fetchedAt))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      lastFetchRef.current = Date.now()
    }
  }, [])

  useEffect(() => {
    load()
    void fetchSettings().then((s) => {
      setCloneFolder(s.cloneFolder)
      setSelectedRepos(s.repos)
    })
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(
    () => window.electronAPI.extensionBridge.on('reviews:changed', () => void load()),
    [load]
  )

  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current >= FOCUS_REFRESH_MS) {
        load()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const handleOpen = (pr: DashboardPR) => {
    void window.electronAPI.extensionBridge.invoke('window:open-pr-review', {
      repoRoot: repoRootFor(pr),
      prNumber: String(pr.number),
      showOverview: 'true',
    })
  }

  const handleClone = async (pr: DashboardPR) => {
    setCloneStatus((prev) => ({ ...prev, [pr.number]: { status: 'cloning' } }))
    try {
      const result = (await githubAPI.cloneRepo(pr.repo, cloneFolder)) as {
        repoRoot?: string
      } | null
      const repoRoot = result?.repoRoot
      setCloneStatus((prev) => {
        const next = { ...prev }
        delete next[pr.number]
        return next
      })
      if (repoRoot) {
        void window.electronAPI.extensionBridge.invoke('window:open-pr-review', {
          repoRoot,
          prNumber: String(pr.number),
          showOverview: 'true',
        })
      }
    } catch (err) {
      setCloneStatus((prev) => ({
        ...prev,
        [pr.number]: { status: 'error', message: err instanceof Error ? err.message : String(err) },
      }))
    }
  }

  const reReview = sortByCloseness(prs.filter((p) => p.section === 're-review'))
  const requested = sortByCloseness(prs.filter((p) => p.section === 'requested'))
  const team = sortByCloseness(prs.filter((p) => p.section === 'team'))
  const mine = sortByOldest(prs.filter((p) => p.section === 'mine'))
  const involved = sortByOldest(prs.filter((p) => p.section === 'involved'))

  const needsYou = [...requested, ...reReview, ...team]
  const needsYouCount = needsYou.length
  const mineCount = mine.length
  const involvedCount = involved.length
  const highRiskCount = needsYou.filter((p) => p.riskLevel === 'high').length
  const totalMinutes = needsYou.reduce((s, p) => s + p.estimatedMinutes, 0)

  const scopeCount = selectedRepos.length || scopedTo
  const scopeLabel = scopeCount > 0 ? `${scopeCount} repositories` : 'All repositories'

  const handleSaved = () => {
    setPickerOpen(false)
    void fetchSettings().then((s) => setSelectedRepos(s.repos))
    void load()
  }

  const chooseButton = (
    <button type="button" className="rd-btn" onClick={() => setPickerOpen(true)}>
      Choose repositories
    </button>
  )

  const updatedText = (() => {
    if (!fetchedAt) return ''
    const minutes = Math.floor((Date.now() - fetchedAt.getTime()) / 60000)
    return minutes < 1 ? 'Updated just now' : `Updated ${minutes} min ago`
  })()

  return (
    <div className="rd-app">
      <div className="rd-bar">
        <span className="rd-t">Reviews</span>
        <span className="rd-chip">{needsYouCount} need you</span>
        <span className="rd-sp" />
        <span className="rd-note">{updatedText}</span>
        <button
          type="button"
          className="rd-btn rd-scope"
          onClick={() => setPickerOpen(true)}
          aria-label={`${scopeLabel}, choose repositories`}
        >
          <ListFilter aria-hidden="true" className="tm-icon-sm" />
          {scopeLabel}
        </button>
        <button type="button" className="rd-btn" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {pickerOpen && (
        <RepoPicker
          initial={selectedRepos}
          onClose={() => setPickerOpen(false)}
          onSaved={handleSaved}
        />
      )}
      <div className="rd-tabs" role="tablist" aria-label="Dashboard sections">
        <button
          role="tab"
          aria-selected={activeTab === 'needs'}
          onClick={() => setActiveTab('needs')}
        >
          Needs you<span className="rd-ct">{needsYouCount}</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'mine'}
          onClick={() => setActiveTab('mine')}
        >
          My PRs<span className="rd-ct">{mineCount}</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'involved'}
          onClick={() => setActiveTab('involved')}
        >
          Involved<span className="rd-ct">{involvedCount}</span>
        </button>
      </div>

      {loading && <div className="rd-note rd-loading">Loading reviews…</div>}

      {!loading && error && (
        <div className="rd-error">
          {error}
          <button type="button" className="rd-btn" onClick={load}>
            Retry
          </button>
          {chooseButton}
        </div>
      )}

      {!loading && !error && failed.length > 0 && (
        <div className="rd-failed" role="alert">
          <AlertTriangle aria-hidden="true" className="tm-icon" />
          <span>{failedSummary(failed)}</span>
          <span className="rd-sp" />
          <button type="button" className="rd-btn" onClick={load}>
            Retry
          </button>
          {chooseButton}
        </div>
      )}

      {!loading && !error && activeTab === 'needs' && (
        <div role="tabpanel">
          <div className="rd-band">
            <b>{needsYouCount} need you</b>
            <span>{highRiskCount} high risk</span>
            <span>About {formatMinutes(totalMinutes)} of reading</span>
            <span className="rd-sp" />
            <span className="rd-note">Sorted by closest to merging</span>
          </div>
          {needsYouCount === 0 && <div className="rd-empty">Nothing needs you</div>}
          {requested.length > 0 && (
            <>
              <div className="rd-grp">REQUESTED OF YOU</div>
              <div className="rd-rows">
                {requested.map((pr) => (
                  <Row
                    key={pr.number}
                    cfg={toNeedsRow(pr)}
                    onOpen={handleOpen}
                    cloneFolder={cloneFolder}
                    cloneState={cloneStatus[pr.number]}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </>
          )}
          {reReview.length > 0 && (
            <>
              <div className="rd-grp">{'RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED'}</div>
              <div className="rd-rows">
                {reReview.map((pr) => (
                  <Row
                    key={pr.number}
                    cfg={toNeedsRow(pr)}
                    onOpen={handleOpen}
                    cloneFolder={cloneFolder}
                    cloneState={cloneStatus[pr.number]}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </>
          )}
          {team.length > 0 && (
            <>
              <div className="rd-grp">REQUESTED OF YOUR TEAM</div>
              <div className="rd-rows">
                {team.map((pr) => (
                  <Row
                    key={pr.number}
                    cfg={toNeedsRow(pr)}
                    onOpen={handleOpen}
                    cloneFolder={cloneFolder}
                    cloneState={cloneStatus[pr.number]}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!loading && !error && activeTab === 'mine' && (
        <div role="tabpanel">
          {mineCount === 0 ? (
            <div className="rd-empty">Nothing needs you</div>
          ) : (
            <>
              <div className="rd-grp">YOUR OPEN PRS</div>
              <div className="rd-rows">
                {mine.map((pr) => (
                  <Row
                    key={pr.number}
                    cfg={toMineRow(pr)}
                    onOpen={handleOpen}
                    cloneFolder={cloneFolder}
                    cloneState={cloneStatus[pr.number]}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!loading && !error && activeTab === 'involved' && (
        <div role="tabpanel">
          {involvedCount === 0 ? (
            <div className="rd-empty">Nothing needs you</div>
          ) : (
            <>
              <div className="rd-grp">MENTIONED, ASSIGNED OR COMMENTED</div>
              <div className="rd-rows">
                {involved.map((pr) => (
                  <Row
                    key={pr.number}
                    cfg={toInvolvedRow(pr)}
                    onOpen={handleOpen}
                    cloneFolder={cloneFolder}
                    cloneState={cloneStatus[pr.number]}
                    onClone={handleClone}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
