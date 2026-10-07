import { AlertTriangle, ListFilter } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { githubAPI } from '../../api/github'
import { DashboardPRSchema, type DashboardPR } from '../../schemas/pr-review.schema'
import { dashboardToSortable, sortPrs } from '../../review/sort-prs'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { DiffSize, RowMeta, shortAge, type MetaPart } from './DiffSize'
import { SortSelect } from './SortSelect'
import { RepoPicker } from './RepoPicker'
import './review-dashboard.css'

type Tab = 'needs' | 'mine' | 'involved'

const FOCUS_REFRESH_MS = 2 * 60 * 1000
const TICK_MS = 60 * 1000
const CAPPED_COUNT = '50+'

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
    capped: z.array(z.enum(SECTIONS)).optional(),
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

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

function ciLabel(pr: DashboardPR): string {
  if (pr.ciStatus === 'none') return 'no checks'
  return `CI ${pr.ciStatus}`
}

function ciPart(pr: DashboardPR): MetaPart | null {
  if (pr.ciStatus === 'passing') return null
  return { text: ciLabel(pr), tone: pr.ciStatus === 'failing' ? 'danger' : undefined }
}

function reviewerPart(pr: DashboardPR): MetaPart | null {
  return pr.reviewerCount > 1 ? { text: `you are 1 of ${pr.reviewerCount} reviewers` } : null
}

function riskPart(pr: DashboardPR): MetaPart | null {
  return pr.riskLevel === 'high' ? { text: 'High risk', tone: 'danger' } : null
}

/** Where the review stands, in words; only the non-neutral ones are coloured. */
function reviewWord(pr: DashboardPR): MetaPart {
  if (pr.reviewDecision === 'changes-requested')
    return { text: 'changes requested', tone: 'warning' }
  if (pr.reviewDecision === 'approved') return { text: 'approved', tone: 'success' }
  return { text: 'waiting for review' }
}

function repoName(repo: string): string {
  return repo.split('/').pop() ?? repo
}

interface RowConfig {
  pr: DashboardPR
  parts: (MetaPart | null)[]
  buttonLabel: string
  primary: boolean
}

interface CloneState {
  status: 'cloning' | 'error'
  message?: string
}

function Row({
  cfg,
  showRepo,
  onOpen,
  cloneFolder,
  cloneState,
  onClone,
}: {
  cfg: RowConfig
  showRepo: boolean
  onOpen: (pr: DashboardPR) => void
  cloneFolder: string
  cloneState?: CloneState
  onClone: (pr: DashboardPR) => void
}): JSX.Element {
  const { pr, parts, buttonLabel, primary } = cfg
  const handle = () => onOpen(pr)
  const showClone = !pr.localRepoRoot && !!cloneFolder
  const hasSession = pr.sessionStatus !== 'not-started'
  const label = pr.sessionStatus === 'paused' ? 'Resume' : hasSession ? 'Continue' : buttonLabel
  const lead: MetaPart[] = showRepo ? [{ text: repoName(pr.repo) }] : []
  const sessionPart: MetaPart[] = hasSession
    ? [{ text: `${pr.viewedFileCount} of ${pr.fileCount} viewed` }]
    : []
  return (
    <div
      className="rd-row rd-row--clickable"
      tabIndex={0}
      data-testid={`row-${pr.number}`}
      onClick={handle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handle()
      }}
    >
      <span className="rd-ti">
        <span className="rd-t1">
          <span className="rd-no">#{pr.number}</span> <span>{pr.title}</span>
        </span>
        <RowMeta
          parts={[
            ...lead,
            { text: pr.author },
            { text: shortAge(pr.createdAt) },
            ...parts,
            ...sessionPart,
            !pr.localRepoRoot && { text: 'Not cloned · diff only' },
          ]}
        />
      </span>
      <span className="rd-side">
        <DiffSize additions={pr.additions} deletions={pr.deletions} fileCount={pr.fileCount} />
        <span className="rd-num">~{pr.estimatedMinutes} min</span>
      </span>
      <span className="rd-actions">
        <button
          type="button"
          className={hasSession ? 'rd-btn rd-pri rd-always' : primary ? 'rd-btn rd-pri' : 'rd-btn'}
          onClick={(e) => {
            e.stopPropagation()
            handle()
          }}
        >
          {label}
        </button>
        {showClone && (
          <button
            type="button"
            className="rd-btn"
            disabled={cloneState?.status === 'cloning'}
            onClick={(e) => {
              e.stopPropagation()
              onClone(pr)
            }}
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
    parts: [
      isReReview
        ? {
            text: `${pr.commitsSinceMyReview} commits since your review`,
          }
        : null,
      reviewerPart(pr),
      riskPart(pr),
      ciPart(pr),
    ],
    buttonLabel: isReReview ? 'Re-review' : 'Review',
    primary: isReReview,
  }
}

function toMineRow(pr: DashboardPR): RowConfig {
  const threads =
    pr.reviewDecision === 'changes-requested'
      ? {
          text: `${pr.unresolvedThreads} unresolved thread${pr.unresolvedThreads === 1 ? '' : 's'}`,
        }
      : null
  return {
    pr,
    parts: [reviewWord(pr), threads, ciPart(pr)],
    buttonLabel: 'Open',
    primary: false,
  }
}

function toInvolvedRow(pr: DashboardPR): RowConfig {
  return { pr, parts: [riskPart(pr), ciPart(pr)], buttonLabel: 'Open', primary: false }
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
  const [capped, setCapped] = useState<string[]>([])
  const { dashboardSort, setDashboardSort } = useReviewUiStore()
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
        setCapped(result.capped ?? [])
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

  const sortSection = (section: DashboardPR['section']) =>
    sortPrs(
      prs.filter((p) => p.section === section),
      dashboardSort,
      dashboardToSortable
    )
  const reReview = sortSection('re-review')
  const requested = sortSection('requested')
  const team = sortSection('team')
  const mine = sortSection('mine')
  const involved = sortSection('involved')

  const needsYou = [...requested, ...reReview, ...team]
  const highRiskCount = needsYou.filter((p) => p.riskLevel === 'high').length
  const totalMinutes = needsYou.reduce((s, p) => s + p.estimatedMinutes, 0)
  const showRepo = new Set(prs.map((p) => p.repo)).size > 1
  const count = (rows: DashboardPR[], ...sections: DashboardPR['section'][]) =>
    sections.some((section) => capped.includes(section)) ? CAPPED_COUNT : String(rows.length)
  const needsYouCount = count(needsYou, 'requested', 're-review', 'team')
  const mineCount = count(mine, 'mine')
  const involvedCount = count(involved, 'involved')

  const renderSection = (
    title: string,
    rows: DashboardPR[],
    toRow: (pr: DashboardPR) => RowConfig,
    ...sections: DashboardPR['section'][]
  ) =>
    rows.length > 0 && (
      <section className="rd-sec">
        <div className="rd-grp">
          <span>{title}</span>
          <span className="rd-ct">{count(rows, ...sections)}</span>
        </div>
        <div className="rd-rows">
          {rows.map((pr) => (
            <Row
              key={`${pr.repo}#${pr.number}`}
              cfg={toRow(pr)}
              showRepo={showRepo}
              onOpen={handleOpen}
              cloneFolder={cloneFolder}
              cloneState={cloneStatus[pr.number]}
              onClone={handleClone}
            />
          ))}
        </div>
      </section>
    )

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
      <div className="rd-tabs">
        <div className="rd-tablist" role="tablist" aria-label="Dashboard sections">
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
        <span className="rd-sp" />
        <SortSelect value={dashboardSort} onChange={setDashboardSort} />
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
          </div>
          {needsYou.length === 0 && <div className="rd-empty">Nothing needs you</div>}
          {renderSection('REQUESTED OF YOU', requested, toNeedsRow, 'requested')}
          {renderSection(
            'RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED',
            reReview,
            toNeedsRow,
            're-review'
          )}
          {renderSection('REQUESTED OF YOUR TEAM', team, toNeedsRow, 'team')}
        </div>
      )}

      {!loading && !error && activeTab === 'mine' && (
        <div role="tabpanel">
          {mine.length === 0 && <div className="rd-empty">Nothing needs you</div>}
          {renderSection('YOUR OPEN PRS', mine, toMineRow, 'mine')}
        </div>
      )}

      {!loading && !error && activeTab === 'involved' && (
        <div role="tabpanel">
          {involved.length === 0 && <div className="rd-empty">Nothing needs you</div>}
          {renderSection('MENTIONED, ASSIGNED OR COMMENTED', involved, toInvolvedRow, 'involved')}
        </div>
      )}
    </div>
  )
}
