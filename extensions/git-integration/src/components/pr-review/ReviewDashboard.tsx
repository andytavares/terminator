import { AlertTriangle, ListFilter } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Tab,
  TabList,
  TabPanel,
  TabsRoot,
  formatRelativeTime,
} from '@terminator/extension-ui'
import { z } from 'zod'
import { githubAPI } from '../../api/github'
import { DashboardPRSchema, type DashboardPR } from '../../schemas/pr-review.schema'
import { dashboardToSortable, sortPrs } from '../../review/sort-prs'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { PrRow, shortAge, type MetaPart } from './DiffSize'
import { SortSelect } from './SortSelect'
import { RepoPicker } from './RepoPicker'
import { plural } from '@terminator/extension-sdk'
import { choose, errorMessageOf } from '../text'
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
function shortError(message: string): string {
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

interface ReviewSettings {
  cloneFolder: string
  repos: string[]
}

function settingsFrom(raw: { cloneFolder?: unknown; repos?: unknown } | null): ReviewSettings {
  const cloneFolder = raw?.cloneFolder
  const repos = raw?.repos
  return {
    cloneFolder: choose(typeof cloneFolder === 'string', cloneFolder as string, ''),
    repos: choose(Array.isArray(repos), repos as string[], []),
  }
}

async function fetchSettings(): Promise<ReviewSettings> {
  try {
    const raw = (await githubAPI.reviewSettings()) as {
      cloneFolder?: unknown
      repos?: unknown
    } | null
    return settingsFrom(raw)
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
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

function dashboardCiLabel(pr: DashboardPR): string {
  if (pr.ciStatus === 'none') return 'no checks'
  return `CI ${pr.ciStatus}`
}

function ciPart(pr: DashboardPR): MetaPart | null {
  if (pr.ciStatus === 'passing') return null
  return {
    text: dashboardCiLabel(pr),
    tone: choose(pr.ciStatus === 'failing', 'danger' as const, undefined),
  }
}

function reviewerPart(pr: DashboardPR): MetaPart | null {
  if (pr.reviewerCount <= 1) return null
  return { text: `you are 1 of ${pr.reviewerCount} reviewers` }
}

function riskPart(pr: DashboardPR): MetaPart | null {
  if (pr.riskLevel !== 'high') return null
  return { text: 'High risk', tone: 'danger' }
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

/** Opens the pull request's review window, with its overview first. */
function openReview(repoRoot: string, prNumber: number): void {
  void window.electronAPI.extensionBridge.invoke('window:open-pr-review', {
    repoRoot,
    prNumber: String(prNumber),
    showOverview: 'true',
  })
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

/** What every row in the dashboard shares. */
interface RowContext {
  showRepo: boolean
  onOpen: (pr: DashboardPR) => void
  cloneFolder: string
  cloneStatus: Record<number, CloneState>
  onClone: (pr: DashboardPR) => void
}

function hasStartedSession(pr: DashboardPR): boolean {
  return pr.sessionStatus !== 'not-started'
}

/** Resume a paused review, continue a started one, or the row's own action. */
function rowButtonLabel(cfg: RowConfig): string {
  if (cfg.pr.sessionStatus === 'paused') return 'Resume'
  if (hasStartedSession(cfg.pr)) return 'Continue'
  return cfg.buttonLabel
}

function rowParts(cfg: RowConfig, showRepo: boolean): (MetaPart | null | false)[] {
  const { pr } = cfg
  const lead: MetaPart[] = choose(showRepo, [{ text: repoName(pr.repo) }], [])
  const progress = { text: `${pr.viewedFileCount} of ${pr.fileCount} viewed` }
  return [
    ...lead,
    { text: pr.author },
    { text: shortAge(pr.createdAt) },
    ...cfg.parts,
    hasStartedSession(pr) && progress,
    !pr.localRepoRoot && { text: 'Not cloned · diff only' },
  ]
}

function CloneButton(props: {
  pr: DashboardPR
  state?: CloneState
  onClone: RowContext['onClone']
}) {
  const cloning = props.state?.status === 'cloning'
  return (
    <Button
      size="sm"
      className="rd-row-action"
      disabled={cloning}
      onClick={(e) => {
        e.stopPropagation()
        props.onClone(props.pr)
      }}
    >
      {choose(cloning, 'Cloning…', 'Clone and review')}
    </Button>
  )
}

/** Clone and review, for a pull request not cloned yet, and why the last clone failed. */
function CloneActions({ pr, ctx }: { pr: DashboardPR; ctx: RowContext }) {
  const cloneState = ctx.cloneStatus[pr.number]
  return (
    <>
      {!pr.localRepoRoot && !!ctx.cloneFolder && (
        <CloneButton pr={pr} state={cloneState} onClone={ctx.onClone} />
      )}
      {cloneState?.status === 'error' && (
        <span className="rd-clone-error">{cloneState.message}</span>
      )}
    </>
  )
}

function DashboardRow({ cfg, ctx }: { cfg: RowConfig; ctx: RowContext }): React.JSX.Element {
  const { pr } = cfg
  const session = hasStartedSession(pr)
  return (
    <PrRow
      pr={pr}
      testId={`row-${pr.number}`}
      onOpen={() => ctx.onOpen(pr)}
      meta={rowParts(cfg, ctx.showRepo)}
      action={{ label: rowButtonLabel(cfg), primary: session || cfg.primary, always: session }}
    >
      <CloneActions pr={pr} ctx={ctx} />
    </PrRow>
  )
}

function toNeedsRow(pr: DashboardPR): RowConfig {
  const isReReview = pr.section === 're-review'
  const since = { text: `${pr.commitsSinceMyReview} commits since your review` }
  return {
    pr,
    parts: [choose(isReReview, since, null), reviewerPart(pr), riskPart(pr), ciPart(pr)],
    buttonLabel: choose(isReReview, 'Re-review', 'Review'),
    primary: isReReview,
  }
}

function threadsPart(pr: DashboardPR): MetaPart | null {
  if (pr.reviewDecision !== 'changes-requested') return null
  const n = pr.unresolvedThreads
  return { text: `${n} unresolved ${plural(n, 'thread')}` }
}

function toMineRow(pr: DashboardPR): RowConfig {
  return {
    pr,
    parts: [reviewWord(pr), threadsPart(pr), ciPart(pr)],
    buttonLabel: 'Open',
    primary: false,
  }
}

function toInvolvedRow(pr: DashboardPR) {
  return { pr, parts: [riskPart(pr), ciPart(pr)], buttonLabel: 'Open', primary: false }
}

type Section = DashboardPR['section']

interface DashboardData {
  prs: DashboardPR[]
  failed: FailedSection[]
  scopedTo: number
  capped: string[]
  fetchedAt: Date | null
}

const EMPTY_DATA: DashboardData = { prs: [], failed: [], scopedTo: 0, capped: [], fetchedAt: null }

/** The error to show for an answer, or null when there is data to show. */
function resultError(result: DashboardResult): string | null {
  if ('error' in result) return shortError(result.error)
  const failed = result.failed ?? []
  // Every section failing is a failure of the whole search.
  if (failed.length >= SECTIONS.length) return shortError(failed[0].error)
  return null
}

function resultData(result: Exclude<DashboardResult, { error: string }>): DashboardData {
  return {
    prs: result.prs,
    failed: result.failed ?? [],
    scopedTo: result.scopedTo ?? 0,
    capped: result.capped ?? [],
    fetchedAt: new Date(result.fetchedAt),
  }
}

/** Reloads when another window changes a review, and on focus when the data is two minutes old. */
function useReloadTriggers(load: () => Promise<void>, lastFetchRef: { current: number }) {
  useEffect(
    () => window.electronAPI.extensionBridge.on('reviews:changed', () => void load()),
    [load]
  )
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current >= FOCUS_REFRESH_MS) load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, lastFetchRef])
}

/** Re-renders every minute so "Updated 3 min ago" stays true. */
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])
}

function useDashboardData() {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<number>(0)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchDashboard()
      const problem = resultError(result)
      if (problem) setError(problem)
      if (problem && !('error' in result)) setData((d) => ({ ...d, failed: [] }))
      if (!problem && !('error' in result)) setData(resultData(result))
    } catch (err) {
      setError(errorMessageOf(err))
    } finally {
      setLoading(false)
      lastFetchRef.current = Date.now()
    }
  }, [])
  useReloadTriggers(load, lastFetchRef)
  useMinuteTick()
  return { data, loading, error, load }
}

type Dashboard = ReturnType<typeof useDashboardData>

/** The clone folder and the repositories the dashboard is scoped to. */
function useReviewSettings(load: () => Promise<void>) {
  const [cloneFolder, setCloneFolder] = useState('')
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  useEffect(() => {
    load()
    void fetchSettings().then((s) => {
      setCloneFolder(s.cloneFolder)
      setSelectedRepos(s.repos)
    })
  }, [load])
  const refreshRepos = () => void fetchSettings().then((s) => setSelectedRepos(s.repos))
  return { cloneFolder, selectedRepos, refreshRepos }
}

type Settings = ReturnType<typeof useReviewSettings>

function withoutKey<T>(record: Record<number, T>, key: number): Record<number, T> {
  const next = { ...record }
  delete next[key]
  return next
}

/** Clones a pull request's repository into the clone folder, then opens its review. */
function useClone(cloneFolder: string) {
  const [cloneStatus, setCloneStatus] = useState<Record<number, CloneState>>({})
  const setState = (prNumber: number, state: CloneState) =>
    setCloneStatus((prev) => ({ ...prev, [prNumber]: state }))
  const handleClone = async (pr: DashboardPR) => {
    setState(pr.number, { status: 'cloning' })
    try {
      const result = (await githubAPI.cloneRepo(pr.repo, cloneFolder)) as {
        repoRoot?: string
      } | null
      setCloneStatus((prev) => withoutKey(prev, pr.number))
      if (result?.repoRoot) openReview(result.repoRoot, pr.number)
    } catch (err) {
      setState(pr.number, { status: 'error', message: errorMessageOf(err) })
    }
  }
  return { cloneStatus, handleClone }
}

/** The pull requests of each section, sorted, and the count each tab shows. */
function groupSections(data: DashboardData, sort: Parameters<typeof sortPrs>[1]) {
  const sorted = (section: Section) =>
    sortPrs(
      data.prs.filter((p) => p.section === section),
      sort,
      dashboardToSortable
    )
  const groups = {
    reReview: sorted('re-review'),
    requested: sorted('requested'),
    team: sorted('team'),
    mine: sorted('mine'),
    involved: sorted('involved'),
  }
  const needsYou = [...groups.requested, ...groups.reReview, ...groups.team]
  return { ...groups, needsYou }
}

/** The number to show for rows from `sections`: "50+" when the search stopped at its cap. */
function sectionCount(capped: string[], rows: DashboardPR[], sections: Section[]): string {
  if (sections.some((section) => capped.includes(section))) return CAPPED_COUNT
  return String(rows.length)
}

interface SectionSpec {
  title: string
  rows: DashboardPR[]
  toRow: (pr: DashboardPR) => RowConfig
  sections: Section[]
}

function DashboardSection(props: { spec: SectionSpec; ctx: RowContext; capped: string[] }) {
  const { spec, ctx, capped } = props
  if (spec.rows.length === 0) return null
  return (
    <section className="rd-sec">
      <div className="rd-grp">
        <span>{spec.title}</span>
        <span className="rd-ct">{sectionCount(capped, spec.rows, spec.sections)}</span>
      </div>
      <div className="rd-rows">
        {spec.rows.map((pr) => (
          <DashboardRow key={`${pr.repo}#${pr.number}`} cfg={spec.toRow(pr)} ctx={ctx} />
        ))}
      </div>
    </section>
  )
}

type Groups = ReturnType<typeof groupSections>

interface PanelProps {
  groups: Groups
  ctx: RowContext
  capped: string[]
}

function needsSpecs(groups: Groups): SectionSpec[] {
  return [
    {
      title: 'REQUESTED OF YOU',
      rows: groups.requested,
      toRow: toNeedsRow,
      sections: ['requested'],
    },
    {
      title: 'RE-REVIEW · NEW COMMITS SINCE YOU REVIEWED',
      rows: groups.reReview,
      toRow: toNeedsRow,
      sections: ['re-review'],
    },
    { title: 'REQUESTED OF YOUR TEAM', rows: groups.team, toRow: toNeedsRow, sections: ['team'] },
  ]
}

function NeedsPanel({ groups, ctx, capped }: PanelProps) {
  const { needsYou } = groups
  const highRiskCount = needsYou.filter((p) => p.riskLevel === 'high').length
  const totalMinutes = needsYou.reduce((s, p) => s + p.estimatedMinutes, 0)
  return (
    <TabPanel id="needs">
      <div className="rd-band">
        <b>{sectionCount(capped, needsYou, NEEDS_SECTIONS)} need you</b>
        <span>{highRiskCount} high risk</span>
        <span>About {formatMinutes(totalMinutes)} of reading</span>
      </div>
      {needsYou.length === 0 && <div className="rd-empty">Nothing needs you</div>}
      {needsSpecs(groups).map((spec) => (
        <DashboardSection key={spec.title} spec={spec} ctx={ctx} capped={capped} />
      ))}
    </TabPanel>
  )
}

function SingleSectionPanel(props: {
  id: Tab
  spec: SectionSpec
  ctx: RowContext
  capped: string[]
}) {
  return (
    <TabPanel id={props.id}>
      {props.spec.rows.length === 0 && <div className="rd-empty">Nothing needs you</div>}
      <DashboardSection spec={props.spec} ctx={props.ctx} capped={props.capped} />
    </TabPanel>
  )
}

const NEEDS_SECTIONS: Section[] = ['requested', 're-review', 'team']

function DashboardPanels({ groups, ctx, capped }: PanelProps) {
  const mine: SectionSpec = {
    title: 'YOUR OPEN PRS',
    rows: groups.mine,
    toRow: toMineRow,
    sections: ['mine'],
  }
  const involved: SectionSpec = {
    title: 'MENTIONED, ASSIGNED OR COMMENTED',
    rows: groups.involved,
    toRow: toInvolvedRow,
    sections: ['involved'],
  }
  return (
    <>
      <NeedsPanel groups={groups} ctx={ctx} capped={capped} />
      <SingleSectionPanel id="mine" spec={mine} ctx={ctx} capped={capped} />
      <SingleSectionPanel id="involved" spec={involved} ctx={ctx} capped={capped} />
    </>
  )
}

function TabCount(props: { id: Tab; name: string; count: string }) {
  return (
    <Tab id={props.id} accessibleName={`${props.name}, ${props.count}`}>
      {props.name}
      <span className="tmui-tabs__count">{props.count}</span>
    </Tab>
  )
}

function DashboardTabs({ groups, capped }: { groups: Groups; capped: string[] }) {
  const { dashboardSort, setDashboardSort } = useReviewUiStore()
  return (
    <div className="rd-tabs">
      <TabList label="Dashboard sections" className="rd-tablist">
        <TabCount
          id="needs"
          name="Needs you"
          count={sectionCount(capped, groups.needsYou, NEEDS_SECTIONS)}
        />
        <TabCount id="mine" name="My PRs" count={sectionCount(capped, groups.mine, ['mine'])} />
        <TabCount
          id="involved"
          name="Involved"
          count={sectionCount(capped, groups.involved, ['involved'])}
        />
      </TabList>
      <span className="rd-sp" />
      <SortSelect value={dashboardSort} onChange={setDashboardSort} />
    </div>
  )
}

function scopeLabelOf(selectedCount: number, scopedTo: number): string {
  const scopeCount = selectedCount || scopedTo
  if (scopeCount === 0) return 'All repositories'
  return `${scopeCount} ${plural(scopeCount, 'repository', 'repositories')}`
}

function updatedText(fetchedAt: Date | null): string {
  if (!fetchedAt) return ''
  return `Updated ${formatRelativeTime(fetchedAt)}`
}

interface BarProps {
  dash: Dashboard
  settings: Settings
  openPicker: () => void
}

function DashboardBar({ dash, settings, openPicker }: BarProps) {
  const scopeLabel = scopeLabelOf(settings.selectedRepos.length, dash.data.scopedTo)
  return (
    <div className="rd-bar">
      <span className="rd-t">Reviews</span>
      <span className="rd-sp" />
      <span className="rd-note">{updatedText(dash.data.fetchedAt)}</span>
      <Button
        aria-label={`${scopeLabel}, choose repositories`}
        size="sm"
        icon={ListFilter}
        onClick={openPicker}
      >
        {scopeLabel}
      </Button>
      <Button size="sm" onClick={dash.load} disabled={dash.loading}>
        Refresh
      </Button>
    </div>
  )
}

function ProblemActions(props: { onRetry: () => void; openPicker: () => void }) {
  return (
    <>
      <Button size="sm" onClick={props.onRetry}>
        Retry
      </Button>
      <Button size="sm" onClick={props.openPicker}>
        Choose repositories
      </Button>
    </>
  )
}

function LoadProblems({ dash, openPicker }: { dash: Dashboard; openPicker: () => void }) {
  const { error } = dash
  const { failed } = dash.data
  const actions = <ProblemActions onRetry={dash.load} openPicker={openPicker} />
  if (error) {
    return (
      <div className="rd-error">
        {error}
        {actions}
      </div>
    )
  }
  if (failed.length === 0) return null
  return (
    <div className="rd-failed" role="alert">
      <AlertTriangle aria-hidden="true" className="tm-icon" />
      <span>{failedSummary(failed)}</span>
      <span className="rd-sp" />
      {actions}
    </div>
  )
}

function useDashboard() {
  const dash = useDashboardData()
  const settings = useReviewSettings(dash.load)
  const { cloneStatus, handleClone } = useClone(settings.cloneFolder)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { dashboardSort } = useReviewUiStore()
  const groups = groupSections(dash.data, dashboardSort)
  const ctx: RowContext = {
    showRepo: new Set(dash.data.prs.map((p) => p.repo)).size > 1,
    onOpen: (pr) => openReview(repoRootFor(pr), pr.number),
    cloneFolder: settings.cloneFolder,
    cloneStatus,
    onClone: handleClone,
  }
  const handleSaved = () => {
    setPickerOpen(false)
    settings.refreshRepos()
    void dash.load()
  }
  return { dash, settings, groups, ctx, pickerOpen, setPickerOpen, handleSaved }
}

export function ReviewDashboard(): React.JSX.Element {
  const d = useDashboard()
  const [activeTab, setActiveTab] = useState<Tab>('needs')
  const { dash } = d
  const openPicker = () => d.setPickerOpen(true)
  return (
    <div className="rd-app">
      <DashboardBar dash={dash} settings={d.settings} openPicker={openPicker} />
      {d.pickerOpen && (
        <RepoPicker
          initial={d.settings.selectedRepos}
          onClose={() => d.setPickerOpen(false)}
          onSaved={d.handleSaved}
        />
      )}
      <TabsRoot selectedId={activeTab} onSelect={setActiveTab}>
        <DashboardTabs groups={d.groups} capped={dash.data.capped} />
        {dash.loading && <div className="rd-note rd-loading">Loading reviews…</div>}
        {!dash.loading && <LoadProblems dash={dash} openPicker={openPicker} />}
        {!dash.loading && !dash.error && (
          <DashboardPanels groups={d.groups} ctx={d.ctx} capped={dash.data.capped} />
        )}
      </TabsRoot>
    </div>
  )
}
