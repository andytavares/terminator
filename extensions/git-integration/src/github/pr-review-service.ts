import type {
  Chapter,
  PrChangedFile,
  RiskScore,
  FileMetrics,
  ReviewQueuePR,
  SignalDots,
  IssueRef,
  DryViolation,
} from '../schemas/pr-review.schema.js'
import type { StatusCheck, IssueComment, InlineComment } from '../schemas/pr-review.schema.js'
import type { FileDiff } from '../schemas/git.schema.js'
import { plural } from '@terminator/extension-sdk'
import {
  BLAST_HIGH_IMPORTERS,
  BLAST_MEDIUM_IMPORTERS,
  CHANGE_HIGH_LINES,
  CHANGE_MEDIUM_LINES,
  CHURN_HIGH_COMMITS,
  CHURN_MEDIUM_COMMITS,
} from '../review/risk-thresholds.js'
import { FileDiffSchema } from '../schemas/git.schema.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplexityHotspot {
  hunkIndex: number
  complexityDelta: number
  message: string
}

type Tier = 0 | 1 | 2 | 3
type SignalValue = 'pass' | 'warn' | 'fail' | 'unknown'
type RawRecord = Record<string, unknown>

interface RawFile {
  path: string
  additions: number
  deletions: number
  changeType?: string
  patch?: string
}

/** A file's risk inputs, each scaled to 0..1 across the PR; null when unknown. */
interface NormalisedMetrics {
  churn: number | null
  blast: number | null
  size: number | null
  complexity: number | null
  coverageGap: number | null
}

interface RiskContribution {
  label: string
  value: number
  /** False when the metric is under its medium floor: it is shown but is not a risk signal. */
  overFloor: boolean
}

/** Totals for a queue row, from its file list when GitHub sent one, else from its counters. */
interface QueueTotals {
  fileCount: number
  additions: number
  deletions: number
  filePaths: string[]
}

/** The tracker connection that fills in an issue's title and state. */
export interface IssueLookup {
  get(
    tracker: 'linear' | 'jira',
    key: string,
    opts?: { refresh?: boolean }
  ): Promise<{ title: string; state: { name: string } } | null>
}

interface HunkLines {
  lines: Array<{ type: string; content: string }>
}

type CommitContext = { name?: string; context?: string; conclusion?: string; state?: string }
type CommitNode = { commit?: { statusCheckRollup?: { contexts?: { nodes?: CommitContext[] } } } }
type ReviewNode = {
  author?: { login?: string; avatarUrl?: string }
  state?: string
  submittedAt?: string
}
type ReviewRequestNode = {
  requestedReviewer?: { login?: string; avatarUrl?: string; name?: string }
}
type Nodes<T> = { nodes?: T[] } | undefined

type DiffLineDraft = FileDiff['hunks'][0]['lines'][0]

// ─── Decision-point keywords for cyclomatic complexity ───────────────────────

const DECISION_KEYWORDS = [
  /\bif\b/g,
  /\belse\s+if\b/g,
  /\bfor\b/g,
  /\bwhile\b/g,
  /\bdo\b/g,
  /\bswitch\b/g,
  /\bcase\b/g,
  /\bcatch\b/g,
  /&&/g,
  /\|\|/g,
  /\?\?/g,
  /\?(?!\?)/g,
]

function countDecisionPoints(line: string): number {
  return DECISION_KEYWORDS.reduce((acc, re) => {
    re.lastIndex = 0
    return acc + (line.match(re)?.length ?? 0)
  }, 0)
}

/** Decision points the hunk adds minus those it removes. */
function hunkDecisionDelta(hunk: FileDiff['hunks'][0]): number {
  let delta = 0
  for (const line of hunk.lines) {
    if (line.type === 'add') delta += countDecisionPoints(line.content)
    else if (line.type === 'remove') delta -= countDecisionPoints(line.content)
  }
  return delta
}

// ─── Complexity hotspot detection ─────────────────────────────────────────────

export function detectComplexityHotspots(diff: FileDiff): ComplexityHotspot[] {
  const hotspots: ComplexityHotspot[] = []
  diff.hunks.forEach((hunk, hunkIndex) => {
    const delta = hunkDecisionDelta(hunk)
    if (delta < 5) return
    const message = `Complexity hotspot — this block adds ${delta} decision points (cyclomatic delta +${delta}).`
    hotspots.push({ hunkIndex, complexityDelta: delta, message })
  })
  return hotspots
}

export function computeFileCyclomaticDelta(diff: FileDiff): number {
  return diff.hunks.reduce((total, hunk) => total + hunkDecisionDelta(hunk), 0)
}

// ─── Risk score computation ────────────────────────────────────────────────────

const MISSING_TEST_PENALTY = 20

const RISK_WEIGHTS: Record<keyof NormalisedMetrics, number> = {
  churn: 0.25,
  blast: 0.25,
  size: 0.2,
  complexity: 0.1,
  coverageGap: 0.05,
}

/** `value` scaled to 0..1 between the smallest and largest of `allValues`. */
function normalise(value: number | null, allValues: (number | null)[]): number | null {
  if (value == null) return null
  const nums = allValues.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  if (max === min) return 0
  return (value - min) / (max - min)
}

function changeSizeOf(m: FileMetrics): number {
  return m.additions + m.deletions
}

function normalisedMetrics(metrics: FileMetrics, all: FileMetrics[]): NormalisedMetrics {
  const coverageGap = metrics.patchCoverage == null ? null : 1 - metrics.patchCoverage / 100
  return {
    churn: normalise(
      metrics.churn90d,
      all.map((m) => m.churn90d)
    ),
    blast: normalise(
      metrics.blastRadius,
      all.map((m) => m.blastRadius)
    ),
    size: normalise(changeSizeOf(metrics), all.map(changeSizeOf)),
    complexity: normalise(
      metrics.complexityDelta,
      all.map((m) => m.complexityDelta)
    ),
    coverageGap,
  }
}

/** The weighted score out of 100, or null when fewer than two inputs are known. */
function compositeScore(norm: NormalisedMetrics, testFilePresent: boolean | null): number | null {
  const known = (Object.keys(RISK_WEIGHTS) as (keyof NormalisedMetrics)[]).filter(
    (k) => norm[k] != null
  )
  if (known.length < 2) return null
  const totalWeight = known.reduce((s, k) => s + RISK_WEIGHTS[k], 0)
  const weighted = known.reduce((s, k) => s + norm[k]! * RISK_WEIGHTS[k], 0)
  const penalty = testFilePresent ? 0 : MISSING_TEST_PENALTY
  return Math.min(100, Math.round((weighted / totalWeight) * 80 + penalty))
}

function churnLabel(commits: number): string {
  const count = `${commits} ${plural(commits, 'commit')} in 90 days`
  return commits >= CHURN_MEDIUM_COMMITS ? `Changes often — ${count}` : count
}

function blastLabel(importers: number): string {
  const count = `Used by ${importers} ${plural(importers, 'file')}`
  return importers >= BLAST_MEDIUM_IMPORTERS ? `${count} — wide reach` : count
}

function sizeLabel(lines: number): string {
  const count = `${lines} ${plural(lines, 'line')}`
  return lines >= CHANGE_HIGH_LINES ? `Large change — ${count}` : `${count} changed`
}

/** Churn and blast radius: how often the file changes and how many files import it. */
function historyContributions(norm: NormalisedMetrics, metrics: FileMetrics): RiskContribution[] {
  const out: RiskContribution[] = []
  if (norm.churn != null && metrics.churn90d != null) {
    const overFloor = metrics.churn90d >= CHURN_MEDIUM_COMMITS
    out.push({
      label: churnLabel(metrics.churn90d),
      value: norm.churn * RISK_WEIGHTS.churn,
      overFloor,
    })
  }
  if (norm.blast != null && metrics.blastRadius != null) {
    const overFloor = metrics.blastRadius >= BLAST_MEDIUM_IMPORTERS
    out.push({
      label: blastLabel(metrics.blastRadius),
      value: norm.blast * RISK_WEIGHTS.blast,
      overFloor,
    })
  }
  return out
}

/** Size, added complexity and a missing test: what this change itself does. */
function changeContributions(norm: NormalisedMetrics, metrics: FileMetrics): RiskContribution[] {
  const out: RiskContribution[] = []
  if (norm.size != null) {
    const lines = changeSizeOf(metrics)
    const overFloor = lines >= CHANGE_MEDIUM_LINES
    out.push({ label: sizeLabel(lines), value: norm.size * RISK_WEIGHTS.size, overFloor })
  }
  if (norm.complexity != null && (metrics.complexityDelta ?? 0) > 0) {
    const label = `Complexity increase — +${metrics.complexityDelta} decision points`
    out.push({ label, value: norm.complexity * RISK_WEIGHTS.complexity, overFloor: true })
  }
  if (!metrics.testFilePresent) {
    out.push({ label: 'Missing test file', value: MISSING_TEST_PENALTY / 100, overFloor: true })
  }
  return out
}

function riskContributions(norm: NormalisedMetrics, metrics: FileMetrics): RiskContribution[] {
  const all = [...historyContributions(norm, metrics), ...changeContributions(norm, metrics)]
  return all.sort((a, b) => b.value - a.value)
}

/** True when any of churn, blast radius or change size reaches its floor. */
function reachesFloor(
  metrics: FileMetrics,
  floor: { churn: number; blast: number; lines: number }
) {
  return (
    (metrics.churn90d ?? 0) >= floor.churn ||
    (metrics.blastRadius ?? 0) >= floor.blast ||
    changeSizeOf(metrics) >= floor.lines
  )
}

const HIGH_FLOOR = {
  churn: CHURN_HIGH_COMMITS,
  blast: BLAST_HIGH_IMPORTERS,
  lines: CHANGE_HIGH_LINES,
}
const MEDIUM_FLOOR = {
  churn: CHURN_MEDIUM_COMMITS,
  blast: BLAST_MEDIUM_IMPORTERS,
  lines: CHANGE_MEDIUM_LINES,
}

/** Level from absolute floors; the relative composite only orders files. */
function riskLevelOf(metrics: FileMetrics): RiskScore['level'] {
  if (reachesFloor(metrics, HIGH_FLOOR)) return 'high'
  if (reachesFloor(metrics, MEDIUM_FLOOR)) return 'medium'
  return 'low'
}

function riskMetricsOf(metrics: FileMetrics): RiskScore['metrics'] {
  const { churn90d, blastRadius, testFilePresent, complexityDelta, patchCoverage } = metrics
  const changeSize = changeSizeOf(metrics)
  return { changeSize, churn90d, blastRadius, testFilePresent, complexityDelta, patchCoverage }
}

function dominantDriverOf(contributions: RiskContribution[]): string {
  const top = contributions.find((c) => c.overFloor)
  return top ? top.label : 'No risk signal over its threshold'
}

export function computeRiskScore(metrics: FileMetrics, allFilesMetrics: FileMetrics[]): RiskScore {
  const norm = normalisedMetrics(metrics, allFilesMetrics)
  const composite = compositeScore(norm, metrics.testFilePresent)
  const dominantDriver = dominantDriverOf(riskContributions(norm, metrics))
  return {
    level: riskLevelOf(metrics),
    composite,
    metrics: riskMetricsOf(metrics),
    dominantDriver,
    topImporters: metrics.topImporters.slice(0, 5),
    importerCount: metrics.importerCount,
  }
}

// ─── Queue-level (list) risk ────────────────────────────────────────────────────

// The PR list is built before any per-file analysis runs, so it can only score risk
// from the coarse signals GitHub returns with the list (total lines changed). Large
// diffs are inherently high-risk/slow to review, so change size alone classifies the
// list-level risk here; once a PR is opened, the deeper per-file `computeRiskScore`
// pass refines it via `updateQueuePrRisk`. Thresholds are the total of additions +
// deletions across the PR. PrReviewView reuses QUEUE_RISK_HIGH_LINES for its
// "large PR" cognitive-load banner, so the two stay in lockstep.
export const QUEUE_RISK_HIGH_LINES = CHANGE_HIGH_LINES
/** @internal */
export const QUEUE_RISK_MEDIUM_LINES = CHANGE_MEDIUM_LINES

export function queueRiskLevel(changeSize: number): 'low' | 'medium' | 'high' {
  if (changeSize >= QUEUE_RISK_HIGH_LINES) return 'high'
  if (changeSize >= QUEUE_RISK_MEDIUM_LINES) return 'medium'
  return 'low'
}

// ─── Chapter building ─────────────────────────────────────────────────────────

const LOCK_OR_GENERATED_PATTERNS = [
  /\.lock$/, // *.lock (yarn, Cargo, Gemfile, poetry, etc.)
  /package-lock\.json$/, // npm
  /pnpm-lock\.yaml$/, // pnpm
  /packages\.lock\.json$/, // .NET
  /gradle\.lockfile$/, // Gradle
  /Package\.resolved$/, // Swift
  /go\.sum$/, // Go
  /go\.work\.sum$/, // Go workspaces
  /requirements\.txt$/, // Python (pinned deps)
  /constraints\.txt$/, // Python pip constraints
  /shrinkwrap\.json$/, // npm shrinkwrap
  /\.generated\.[^.]+$/, // generated / mechanical files
  /\.snap$/, // test snapshots
  /\.pb\.go$/, // protobuf Go
  /\.pb\.swift$/, // protobuf Swift
  /_pb2\.py$/, // protobuf Python
  /\.pb\.cc$|\.pb\.h$/, // protobuf C++
  /GraphQL\.swift$/, // Apollo GraphQL generated
  /API\.graphql\.swift$/,
]

function isLockOrGeneratedFile(name: string): boolean {
  return LOCK_OR_GENERATED_PATTERNS.some((re) => re.test(name))
}

const TYPE_FILE_NAMES = new Set(['types.ts', 'interfaces.ts', 'index.ts'])
const TYPE_FILE_RE = new RegExp('\\.(d\\.ts|types?\\.ts|interface\\.ts)$')

/** Test files by name, per language: JS/TS, Go, Python, Ruby, Java, Swift. */
const TEST_NAME_PATTERNS = [
  /\.(spec|test)\.[^.]+$/,
  /_test\.go$/,
  /^test_.*\.py$/,
  /^conftest\.py$/,
  /_(spec|test)\.rb$/,
  /Tests?\.java$|Spec\.java$/,
  /Tests?\.swift$|Spec\.swift$/,
]

function isTypeFile(name: string): boolean {
  return TYPE_FILE_RE.test(name) || TYPE_FILE_NAMES.has(name)
}

function isTestFile(path: string, name: string): boolean {
  if (path.includes('__tests__/') || /^tests\/.*\.rs$/.test(path)) return true
  return TEST_NAME_PATTERNS.some((re) => re.test(name))
}

export function classifyTier(path: string): Tier {
  const name = path.split('/').pop() ?? path
  if (isTypeFile(name)) return 0
  if (isTestFile(path, name)) return 2
  if (isLockOrGeneratedFile(name)) return 3
  return 1
}

// Layer score for tier-1 files: higher = more likely a consumer/dependent → shown first.
// Lower = more likely a provider/dependee → shown after its consumers.
const LAYER_PATTERNS: [RegExp, number][] = [
  [/\b(route|router|routing)\b/, 9],
  [/\b(page|screen|app|main)\b/, 8],
  [/\b(component|widget|panel|dialog|modal)\b/, 7],
  [/^use[a-z]/, 6],
  [/\bhook\b/, 6],
  [/\b(store|slice|context|state)\b/, 5],
  [/\b(service|handler|controller|api|manager|middleware)\b/, 4],
  [/\b(repository|gateway|client|adapter)\b/, 3],
  [/\b(model|entity|domain|schema|validator|dto)\b/, 2],
  [/\b(util|utils|helper|helpers|lib|common|shared|format|parse|transform)\b/, 1],
  [/\b(config|constant|constants|env|settings)\b/, 1],
]

function layerScore(path: string): number {
  const stem = (path.split('/').pop() ?? path).toLowerCase().replace(/\.[^.]+$/, '')
  return LAYER_PATTERNS.find(([re]) => re.test(stem))?.[1] ?? 4
}

const WHY_HERE: Record<Tier, string> = {
  0: 'Interface/type file — contract foundation for the source files above',
  1: 'Source file — implementation',
  2: 'Test file — validates the implementation above',
  3: 'Mechanical change — lock file, generated output, or formatting only',
}

// ─── Semantic grouping (Signal 1) ─────────────────────────────────────────────

// Ordered from most foundational to least. Lower index wins when groups are merged.
// Each entry is [segmentPattern, groupName] — pattern is matched against WHOLE directory
// segments (split by '/') so 'test-batch' won't spuriously match 'tests'.
const CANONICAL_GROUPS: [RegExp, string][] = [
  [/^(migrations?|db)$/, 'Data Layer'],
  [/^(models?|entities|entity|schemas?)$/, 'Data Layer'],
  [/^(config|settings?|env)$/, 'Configuration'],
  [/^(types?|interfaces?|contracts?)$/, 'Types & Contracts'],
  [/^(services?|core|lib|utils?|helpers?)$/, 'Business Logic'],
  [/^(api|routes?|controllers?|endpoints?|handlers?)$/, 'API Layer'],
  [/^(components?|pages?|views?|ui|screens?)$/, 'UI'],
  [/^(tests?|__tests__|specs?|e2e)$/, 'Tests'],
]

function parentDirName(path: string): string {
  const parts = path.split('/')
  if (parts.length > 1) return parts[parts.length - 2]
  return 'root'
}

// Matches whole directory segments, deepest first, so '__tests__' inside 'components/'
// is Tests, not UI, and 'test-batch' never matches 'tests'.
function semanticGroupName(filePath: string): string {
  const dirSegments = filePath
    .split('/')
    .slice(0, -1)
    .map((s) => s.toLowerCase())
    .reverse()
  for (const segment of dirSegments) {
    const hit = CANONICAL_GROUPS.find(([pattern]) => pattern.test(segment))
    if (hit) return hit[1]
  }
  return parentDirName(filePath)
}

// ─── Feature-stem merge (Signal 2) ────────────────────────────────────────────

const ROLE_SUFFIX_RE =
  /[._-](types?|d|service|store|spec|test|handler|controller|router?|reducer|action|selector|hook|util|helper|dto|schema|model|entity|middleware|resolver|repo(?:sitory)?|gateway|client|adapter|factory|builder|provider|context|state|slice|saga|epic|effect|guard|interceptor|validator|mapper|transformer|formatter|parser)$/i

function featureStem(filePath: string): string {
  const base = (filePath.split('/').pop() ?? filePath).replace(/\.[^.]+$/, '')
  const stripped = base.replace(ROLE_SUFFIX_RE, '')
  return (stripped || base).toLowerCase().replace(/[._-]/g, '')
}

// ─── Import graph (Signal 3) ───────────────────────────────────────────────────

const IMPORT_RE = /(?:import\s+[^'"]*from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g

function resolvePath(fromDir: string, spec: string): string {
  const parts = (fromDir ? fromDir + '/' + spec : spec).split('/')
  const result: string[] = []
  for (const part of parts) {
    if (part === '..') result.pop()
    else if (part !== '.') result.push(part)
  }
  return result.join('/')
}

/** The known path a relative import resolves to: the file itself, with an extension, or its index. */
function knownPathFor(resolved: string, knownPaths: Set<string>): string | undefined {
  return [...knownPaths].find(
    (p) => p === resolved || p.startsWith(resolved + '.') || p.startsWith(resolved + '/index.')
  )
}

function extractImports(patch: string, fromPath: string, knownPaths: Set<string>): string[] {
  const fromDir = fromPath.split('/').slice(0, -1).join('/')
  const found: string[] = []
  for (const match of patch.matchAll(IMPORT_RE)) {
    if (!match[1].startsWith('.')) continue
    const hit = knownPathFor(resolvePath(fromDir, match[1]), knownPaths)
    if (hit) found.push(hit)
  }
  return found
}

// ─── Union-find for group merging ──────────────────────────────────────────────

/** Lower CANONICAL_GROUPS index = more foundational; fallback groups rank after all of them. */
function groupPriority(group: string): number {
  const index = CANONICAL_GROUPS.findIndex(([, n]) => n === group)
  if (index === -1) return 999
  return index
}

class UnionFind {
  private parent = new Map<string, string>()

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (groupPriority(ra) <= groupPriority(rb)) this.parent.set(rb, ra)
    else this.parent.set(ra, rb)
  }
}

// ─── Three-signal grouping ─────────────────────────────────────────────────────

const MAX_GROUP_SIZE = 15

/** Each file's starting group, merged as the signals connect them. */
class FileGrouping {
  readonly uf = new UnionFind()
  readonly fileGroup: Map<string, string>

  constructor(files: RawFile[]) {
    this.fileGroup = new Map(files.map((f) => [f.path, semanticGroupName(f.path)]))
  }

  /** Merges the groups of two files, when both files are in the PR. */
  unionFiles(a: string, b: string): void {
    const ga = this.fileGroup.get(a)
    const gb = this.fileGroup.get(b)
    if (ga && gb) this.uf.union(ga, gb)
  }

  groupIdOf(path: string): string {
    return this.uf.find(this.fileGroup.get(path)!)
  }
}

/** Signal 2: groups whose files share a feature stem (3+ chars, to skip noise) merge. */
function mergeByFeatureStem(grouping: FileGrouping): void {
  const stemToGroups = new Map<string, string[]>()
  for (const [path, group] of grouping.fileGroup) {
    const stem = featureStem(path)
    if (stem.length >= 3) stemToGroups.set(stem, [...(stemToGroups.get(stem) ?? []), group])
  }
  for (const groups of stemToGroups.values()) {
    for (const group of groups.slice(1)) grouping.uf.union(groups[0], group)
  }
}

/** Signal 3: files git history shows changing together, and files one imports. */
function mergeByCoupling(
  grouping: FileGrouping,
  files: RawFile[],
  coChangeAffinity?: Map<string, string[]>
): void {
  const knownPaths = new Set(files.map((f) => f.path))
  for (const f of files) {
    for (const other of coChangeAffinity?.get(f.path) ?? []) grouping.unionFiles(f.path, other)
  }
  for (const f of files) {
    if (!f.patch) continue
    for (const imported of extractImports(f.patch, f.path, knownPaths)) {
      grouping.unionFiles(f.path, imported)
    }
  }
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value])
}

/** A group over MAX_GROUP_SIZE splits by immediate parent directory. */
function withOversizedSplit(groups: Map<string, RawFile[]>): Map<string, RawFile[]> {
  const result = new Map<string, RawFile[]>()
  for (const [key, groupFiles] of groups) {
    if (groupFiles.length <= MAX_GROUP_SIZE) {
      result.set(key, groupFiles)
      continue
    }
    for (const f of groupFiles) pushTo(result, `${key} / ${parentDirName(f.path)}`, f)
  }
  return result
}

function groupFilesIntoChapters(
  files: RawFile[],
  coChangeAffinity?: Map<string, string[]>
): Map<string, RawFile[]> {
  const grouping = new FileGrouping(files)
  mergeByFeatureStem(grouping)
  mergeByCoupling(grouping, files, coChangeAffinity)
  const groups = new Map<string, RawFile[]>()
  for (const f of files) pushTo(groups, grouping.groupIdOf(f.path), f)
  return withOversizedSplit(groups)
}

function defaultRiskScore(): RiskScore {
  return {
    level: 'low',
    composite: null,
    metrics: {
      changeSize: null,
      churn90d: null,
      blastRadius: null,
      testFilePresent: null,
      complexityDelta: null,
      patchCoverage: null,
    },
    dominantDriver: 'Not yet computed',
    topImporters: [],
    importerCount: 0,
  }
}

/** The first of `keys` set on `obj`. */
function firstOf(obj: object, keys: string[]): unknown {
  return keys.map((k) => (obj as RawRecord)[k]).find((v) => v != null)
}

function rawFileFrom(raw: unknown): RawFile {
  const obj = raw as RawRecord
  return {
    path: String(firstOf(obj, ['path', 'filename']) ?? ''),
    additions: Number(obj.additions ?? 0),
    deletions: Number(obj.deletions ?? 0),
    changeType: String(firstOf(obj, ['changeType', 'status']) ?? 'modified'),
    patch: obj.patch ? String(obj.patch) : undefined,
  }
}

function estimatedMinutesFor(lines: number): number {
  return Math.max(1, Math.ceil(lines / 60))
}

function changedFileFrom(f: RawFile, tier: Tier): PrChangedFile {
  return {
    path: f.path,
    changeType: mapChangeType(f.changeType ?? 'modified'),
    additions: f.additions,
    deletions: f.deletions,
    isBinary: false,
    tier,
    whyHere: WHY_HERE[tier],
    riskScore: defaultRiskScore(),
    estimatedMinutes: estimatedMinutesFor(f.additions + f.deletions),
  }
}

/** Implementation first (by layer, then size), then types, tests and mechanical changes. */
const TIER_READING_ORDER: Tier[] = [1, 0, 2, 3]

function byLayerThenSize(a: RawFile, b: RawFile): number {
  const ld = layerScore(b.path) - layerScore(a.path)
  if (ld !== 0) return ld
  return b.additions + b.deletions - (a.additions + a.deletions)
}

function tierOrderedFiles(groupFiles: RawFile[]): PrChangedFile[] {
  return TIER_READING_ORDER.flatMap((tier) => {
    const inTier = groupFiles.filter((f) => classifyTier(f.path) === tier)
    if (tier === 1) inTier.sort(byLayerThenSize)
    return inTier.map((f) => changedFileFrom(f, tier))
  })
}

function chapterFor(
  groupKey: string,
  groupFiles: RawFile[],
  overrides?: Record<string, string[]>
): Chapter {
  const id = groupKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const files = applyOverrides(tierOrderedFiles(groupFiles), overrides?.[id])
  const estimatedMinutes = files.reduce((s, f) => s + f.estimatedMinutes, 0)
  return { id, name: groupKey, files, estimatedMinutes, status: 'not-started' }
}

function isMechanicalGroup([, groupFiles]: [string, RawFile[]]): boolean {
  return groupFiles.every((f) => classifyTier(f.path) === 3)
}

export function buildChapters(
  rawFiles: unknown[],
  overrides?: Record<string, string[]>,
  coChangeAffinity?: Map<string, string[]>
): Chapter[] {
  const files = rawFiles.map(rawFileFrom).filter((f) => f.path.length > 0)
  if (files.length === 0) return []
  const groups = [...groupFilesIntoChapters(files, coChangeAffinity)]
  const regular = groups.filter((g) => !isMechanicalGroup(g))
  const mechanical = groups.filter(isMechanicalGroup)
  return [...regular, ...mechanical].map(([key, groupFiles]) =>
    chapterFor(key, groupFiles, overrides)
  )
}

function applyOverrides(files: PrChangedFile[], order?: string[]): PrChangedFile[] {
  if (!order || order.length === 0) return files
  const fileMap = new Map(files.map((f) => [f.path, f]))
  const ordered: PrChangedFile[] = []
  for (const path of order) {
    const f = fileMap.get(path)
    if (!f) continue
    ordered.push(f)
    fileMap.delete(path)
  }
  return [...ordered, ...fileMap.values()]
}

const CHANGE_TYPES = new Map<string, PrChangedFile['changeType']>([
  ['added', 'added'],
  ['removed', 'deleted'],
  ['deleted', 'deleted'],
  ['renamed', 'renamed'],
])

function mapChangeType(raw: string): PrChangedFile['changeType'] {
  return CHANGE_TYPES.get(raw.toLowerCase()) ?? 'modified'
}

// ─── Check states ─────────────────────────────────────────────────────────────

const FAILED_STATES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'])
const RUNNING_STATES = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED'])
const RUNNING_OR_WAITING_STATES = new Set([...RUNNING_STATES, 'WAITING'])
const SKIPPED_STATES = new Set(['SKIPPED', 'NEUTRAL', 'CANCELLED'])
/** mapCheckStatus does not count ACTION_REQUIRED as failed. */
const CHECK_FAILED_STATES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT'])

const CI_STATUS_BY_SIGNAL: Record<SignalValue, ReviewQueuePR['ciStatus']> = {
  fail: 'failing',
  warn: 'pending',
  pass: 'passing',
  unknown: 'none',
}

/** Failed beats running beats succeeded; skipped, neutral or cancelled checks never decide it, so a
 *  rollup of only those is unknown. */
function rollupVerdict(states: string[], failed: Set<string>, running: Set<string>): SignalValue {
  if (states.some((s) => failed.has(s))) return 'fail'
  if (states.some((s) => running.has(s))) return 'warn'
  if (states.some((s) => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

/** The upper-cased state of each check; gh puts it in `state` or `conclusion`. */
function checkStates(checks: RawRecord[], first: 'state' | 'conclusion'): string[] {
  const second = first === 'state' ? 'conclusion' : 'state'
  return checks.map((s) => String(s[first] ?? s[second] ?? '').toUpperCase())
}

function checksNamed(rollup: RawRecord[], keywords: string[]): RawRecord[] {
  return rollup.filter((s) => {
    const name = String(s.name ?? s.context ?? '').toLowerCase()
    return keywords.some((k) => name.includes(k))
  })
}

function asRollup(rollup: unknown): RawRecord[] | null {
  if (!rollup || !Array.isArray(rollup)) return null
  return rollup as RawRecord[]
}

// ─── Queue PR parsing ─────────────────────────────────────────────────────────

const LINT_NAMES = ['lint', 'eslint', 'rubocop', 'flake8', 'pylint', 'stylelint', 'tslint']
const COVERAGE_NAMES = ['coverage', 'codecov', 'coveralls', 'sonar', 'codeclimate', 'lcov']

function checkSignal(rollup: unknown, keywords: string[]): SignalValue {
  const checks = checksNamed(asRollup(rollup) ?? [], keywords)
  return rollupVerdict(checkStates(checks, 'state'), FAILED_STATES, RUNNING_STATES)
}

function ciSignal(rollup: unknown): SignalValue {
  return rollupVerdict(checkStates(asRollup(rollup) ?? [], 'state'), FAILED_STATES, RUNNING_STATES)
}

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|py|rb|go|java|cs)$/

function isJsTestPath(p: string): boolean {
  return /\.(spec|test)\.[^.]+$/.test(p) || p.includes('__tests__')
}

function testsSignal(filePaths: string[]): SignalValue {
  const sourceFiles = filePaths.filter((p) => SOURCE_FILE_RE.test(p) && !isJsTestPath(p))
  if (sourceFiles.length === 0) return 'unknown'
  const testFiles = filePaths.filter(isJsTestPath)
  if (testFiles.length === 0) return 'fail'
  // A source file is covered when a test file in the PR names its stem.
  const covered = sourceFiles.filter((src) => {
    const stem = src.replace(/\.[^.]+$/, '').replace(/\/index$/, '')
    return testFiles.some((t) => t.includes(stem.split('/').pop()!))
  })
  if (covered.length === 0 || covered.length < sourceFiles.length / 2) return 'warn'
  return 'pass'
}

function churnSignal(totalLines: number, fileCount: number): SignalValue {
  if (fileCount === 0) return 'unknown'
  const perFile = totalLines / fileCount
  if (perFile > 200) return 'fail'
  if (perFile > 80) return 'warn'
  return 'pass'
}

function blastSignal(fileCount: number): SignalValue {
  if (fileCount > 15) return 'fail'
  if (fileCount > 6) return 'warn'
  return 'pass'
}

function sumOf(files: RawRecord[], key: 'additions' | 'deletions'): number {
  return files.reduce((s, f) => s + Number(f[key] ?? 0), 0)
}

function queueTotals(obj: RawRecord): QueueTotals {
  const files = (obj.files as RawRecord[] | undefined) ?? []
  const filePaths = files.map((f) => String(firstOf(f, ['path', 'filename']) ?? ''))
  if (files.length === 0) {
    const [additions, deletions] = [Number(obj.additions ?? 0), Number(obj.deletions ?? 0)]
    return { fileCount: Number(obj.changedFiles ?? 0), additions, deletions, filePaths }
  }
  const [additions, deletions] = [sumOf(files, 'additions'), sumOf(files, 'deletions')]
  return { fileCount: files.length, additions, deletions, filePaths }
}

function signalDotsFor(totals: QueueTotals, rollup: unknown): SignalDots {
  return {
    tests: testsSignal(totals.filePaths),
    coverage: checkSignal(rollup, COVERAGE_NAMES),
    ci: ciSignal(rollup),
    lint: checkSignal(rollup, LINT_NAMES),
    churn: churnSignal(totals.additions + totals.deletions, totals.fileCount),
    blast: blastSignal(totals.fileCount),
  }
}

/** Approvers from the REST `reviews` field or GraphQL `latestReviews.nodes`, once each. */
function approversOf(obj: RawRecord): string[] {
  const reviews =
    (obj.reviews as RawRecord[] | undefined) ?? (obj.latestReviews as Nodes<RawRecord>)?.nodes ?? []
  const approvers = reviews
    .filter((r) => String(r.state ?? '').toUpperCase() === 'APPROVED')
    .map((r) => String(((r.author as RawRecord) ?? {}).login ?? ''))
    .filter(Boolean)
  return [...new Set(approvers)]
}

/** Assignees as normalizeGraphQLNode flattens them, or from the REST `assignees` field. */
export function assigneeLoginsOf(obj: RawRecord): string[] {
  if (Array.isArray(obj.assigneeLogins)) return obj.assigneeLogins as string[]
  if (!Array.isArray(obj.assignees)) return []
  return (obj.assignees as RawRecord[]).map((a) => String(a.login ?? '')).filter(Boolean)
}

const PR_STATES: Record<string, 'merged' | 'closed'> = { MERGED: 'merged', CLOSED: 'closed' }

const QUEUE_MERGE_STATES: Record<string, ReviewQueuePR['mergeStateStatus']> = {
  BEHIND: 'behind',
  DIRTY: 'dirty',
  CLEAN: 'clean',
  HAS_HOOKS: 'clean',
}

function upper(value: unknown): string {
  return String(value ?? '').toUpperCase()
}

export function asText(value: unknown): string {
  return String(value ?? '')
}

/** Who and what the PR is: number, title, author, branches, state. */
function queueIdentity(obj: RawRecord) {
  const author = (obj.author ?? {}) as RawRecord
  return {
    number: Number(obj.number),
    title: asText(obj.title),
    author: asText(author.login),
    authorAvatarUrl: asText(author.avatarUrl),
    openedAt: asText(obj.createdAt),
    headRefName: asText(obj.headRefName),
    baseRefName: asText(obj.baseRefName),
    state: PR_STATES[upper(obj.state)] ?? 'open',
    isDraft: Boolean(obj.isDraft),
  }
}

/** Where review stands: approvals, requested reviewers, assignees and mergeability. */
function queueReviewState(obj: RawRecord) {
  const approvedBy = approversOf(obj)
  const requested = obj.requestedReviewers
  return {
    approvalCount: approvedBy.length,
    approvedBy,
    requestedReviewers: Array.isArray(requested) ? (requested as string[]) : [],
    assigneeLogins: assigneeLoginsOf(obj),
    mergeStateStatus: QUEUE_MERGE_STATES[upper(obj.mergeStateStatus)] ?? 'unknown',
  }
}

export function parseReviewQueuePR(raw: unknown): ReviewQueuePR {
  const obj = raw as RawRecord
  const totals = queueTotals(obj)
  const changeSize = totals.additions + totals.deletions
  return {
    ...queueIdentity(obj),
    ciStatus: CI_STATUS_BY_SIGNAL[ciSignal(obj.statusCheckRollup)],
    fileCount: totals.fileCount,
    additions: totals.additions,
    deletions: totals.deletions,
    estimatedMinutes: estimatedMinutesFor(changeSize),
    riskLevel: queueRiskLevel(changeSize),
    signalDots: signalDotsFor(totals, obj.statusCheckRollup),
    sessionStatus: 'not-started',
    viewedFileCount: 0,
    ...queueReviewState(obj),
  }
}

// ─── Chapter risk ─────────────────────────────────────────────────────────────

export function chapterRiskLevel(chapter: Chapter): 'low' | 'medium' | 'high' {
  const scoreable = chapter.files.filter((f) => f.tier !== 3)
  if (scoreable.some((f) => f.riskScore.level === 'high')) return 'high'
  if (scoreable.some((f) => f.riskScore.level === 'medium')) return 'medium'
  return 'low'
}

// ─── Hunk classification (formatting vs semantic) ─────────────────────────────

function trimmedLinesOf(hunk: HunkLines, type: 'add' | 'remove'): string[] {
  return hunk.lines.filter((l) => l.type === type).map((l) => l.content.trim())
}

function sameMultiset(a: string[], b: string[]): boolean {
  const counts = new Map<string, number>()
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1)
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) - 1)
  return [...counts.values()].every((v) => v === 0)
}

/** Formatting when the added and removed lines are the same multiset once trimmed. */
export function classifyHunk(hunk: HunkLines): 'semantic' | 'formatting' {
  const added = trimmedLinesOf(hunk, 'add')
  const removed = trimmedLinesOf(hunk, 'remove')
  // A hunk of only context lines changes nothing to filter out.
  if (added.length === 0 && removed.length === 0) return 'semantic'
  if (added.length !== removed.length) return 'semantic'
  if (sameMultiset(added, removed)) return 'formatting'
  return 'semantic'
}

// ─── Issue reference extraction ───────────────────────────────────────────────

export function extractIssueRefs(body: string): IssueRef[] {
  // GitHub: Fixes #123, Closes #456, Resolves #789, Related #012
  const github = [...body.matchAll(/(?:fixes|closes|resolves|related)\s+#(\d+)/gi)].map(
    (m): IssueRef => ({ type: 'github', ref: `#${m[1]}` })
  )
  // Linear: https://linear.app/team/issue/TEAM-123
  const linear = [...body.matchAll(/https?:\/\/linear\.app\/[^\s/]+\/issue\/([A-Z]+-\d+)/g)].map(
    (m): IssueRef => ({ type: 'linear', ref: m[1], url: m[0] })
  )
  // Jira: https://your-team.atlassian.net/browse/TEAM-123
  const jira = [
    ...body.matchAll(/https?:\/\/[^\s/]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]*-\d+)/g),
  ].map((m): IssueRef => ({ type: 'jira', ref: m[1], url: m[0] }))
  return [...github, ...linear, ...jira]
}

async function enrichIssueRef(ref: IssueRef, issues: IssueLookup): Promise<IssueRef> {
  if (ref.type === 'github') return ref
  try {
    const issue = await issues.get(ref.type, ref.ref)
    if (issue === null) return ref
    return { ...ref, title: issue.title, state: issue.state.name }
  } catch {
    return ref
  }
}

/**
 * Adds each tracker issue's title and state, which a key scraped from the PR body
 * cannot carry. Best-effort: an unconnected or unreachable tracker leaves refs as they are.
 */
export async function enrichIssueRefs(
  refs: IssueRef[],
  issues: IssueLookup | undefined
): Promise<IssueRef[]> {
  if (!issues) return refs
  return Promise.all(refs.map((ref) => enrichIssueRef(ref, issues)))
}

// ─── DRY violation detection ──────────────────────────────────────────────────

const DRY_WINDOW = 5

function normalizeForDry(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/['"`]/g, '"')
    .replace(/\b[a-z_][a-zA-Z0-9_]*\b/g, 'X')
    .replace(/\d+/g, 'N')
    .trim()
}

/** Each run of DRY_WINDOW normalized added lines in `patch`. */
function addedLineWindows(patch: string): string[] {
  const added = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => normalizeForDry(l.slice(1)))
    .filter((l) => l.length > 10)
  const windows: string[] = []
  for (let i = 0; i + DRY_WINDOW <= added.length; i++) {
    windows.push(added.slice(i, i + DRY_WINDOW).join('\n'))
  }
  return windows
}

export function detectDryViolations(
  files: Array<{ path: string; patch?: string }>
): DryViolation[] {
  const fingerprints = new Map<string, Set<string>>()
  for (const file of files) {
    for (const block of addedLineWindows(file.patch ?? '')) {
      fingerprints.set(block, (fingerprints.get(block) ?? new Set()).add(file.path))
    }
  }
  return [...fingerprints]
    .filter(([, fileSet]) => fileSet.size >= 2)
    .map(([fingerprint, fileSet]) => ({
      files: [...fileSet],
      fingerprint,
      lineCount: DRY_WINDOW,
    }))
}

// ─── gh response mappers (pure; moved from github.ipc.ts) ────────────────────

function rollupFromCommits(obj: RawRecord): RawRecord[] {
  const commits = obj.commits as Nodes<CommitNode>
  const contexts = commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  return contexts.map((ctx) => {
    const state = asText(firstOf(ctx, ['conclusion', 'state']))
    return { name: asText(firstOf(ctx, ['name', 'context'])), state, conclusion: state }
  })
}

function requestedReviewerLogins(obj: RawRecord): string[] {
  const nodes = (obj.reviewRequests as Nodes<ReviewRequestNode>)?.nodes ?? []
  return nodes
    .map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.name ?? '')
    .filter(Boolean)
}

export function normalizeGraphQLNode(node: unknown): Record<string, unknown> {
  const obj = node as RawRecord
  const assigneeNodes = (obj.assignees as Nodes<{ login?: string }>)?.nodes ?? []
  return {
    ...obj,
    statusCheckRollup: rollupFromCommits(obj),
    latestReviews: { nodes: (obj.latestReviews as Nodes<ReviewNode>)?.nodes ?? [] },
    requestedReviewers: requestedReviewerLogins(obj),
    assigneeLogins: assigneeNodes.map((n) => n.login ?? '').filter(Boolean),
  }
}

export const LINT_CHECK_NAMES = [
  'lint',
  'eslint',
  'rubocop',
  'flake8',
  'pylint',
  'stylelint',
  'prettier',
  'tslint',
]
export const COVERAGE_CHECK_NAMES = [
  'coverage',
  'codecov',
  'coveralls',
  'sonar',
  'codeclimate',
  'lcov',
]

const MERGE_STATES: Record<string, 'behind' | 'dirty' | 'clean'> = {
  BEHIND: 'behind',
  DIRTY: 'dirty',
  CONFLICTING: 'dirty',
  CLEAN: 'clean',
  HAS_HOOKS: 'clean',
  UNSTABLE: 'clean',
  BLOCKED: 'clean',
}

export function mapMergeStateStatus(raw: string): 'behind' | 'dirty' | 'clean' | 'unknown' {
  return MERGE_STATES[raw.toUpperCase()] ?? 'unknown'
}

export function mapCiStatus(rollup: unknown): 'passing' | 'failing' | 'pending' | 'none' {
  const states = checkStates(asRollup(rollup) ?? [], 'conclusion')
  return CI_STATUS_BY_SIGNAL[rollupVerdict(states, FAILED_STATES, RUNNING_OR_WAITING_STATES)]
}

export function mapCheckStatus(
  rollup: unknown,
  names: string[]
): 'pass' | 'fail' | 'warn' | 'unknown' {
  const states = checkStates(checksNamed(asRollup(rollup) ?? [], names), 'conclusion')
  return rollupVerdict(states, CHECK_FAILED_STATES, RUNNING_STATES)
}

function statusCheckState(raw: string): StatusCheck['state'] {
  if (raw === 'SUCCESS') return 'pass'
  if (FAILED_STATES.has(raw)) return 'fail'
  if (RUNNING_OR_WAITING_STATES.has(raw)) return 'pending'
  if (SKIPPED_STATES.has(raw)) return 'skipped'
  return 'unknown'
}

export function mapStatusChecks(rollup: unknown): StatusCheck[] {
  return (asRollup(rollup) ?? []).map((s) => ({
    name: String(s.name ?? s.context ?? 'Unknown check'),
    state: statusCheckState(upper(s.conclusion ?? s.state)),
    url: s.url ? String(s.url) : undefined,
  }))
}

function reviewLogin(r: RawRecord): string {
  return String(((r.user as RawRecord) ?? {}).login ?? '')
}

export function mapApprovals(
  reviews: Array<Record<string, unknown>>
): Array<{ author: string; authorAvatarUrl: string; submittedAt: string }> {
  // Each author's latest decisive review counts: a later CHANGES_REQUESTED dismisses an
  // earlier approval, while a later COMMENTED review does not.
  const byAuthor = new Map<string, RawRecord>()
  for (const r of reviews) {
    const login = reviewLogin(r)
    if (login && (!byAuthor.has(login) || upper(r.state) !== 'COMMENTED')) byAuthor.set(login, r)
  }
  return [...byAuthor.values()]
    .filter((r) => upper(r.state) === 'APPROVED')
    .map((r) => ({
      author: reviewLogin(r),
      authorAvatarUrl: String(((r.user as RawRecord) ?? {}).avatar_url ?? ''),
      submittedAt: String(r.submitted_at ?? ''),
    }))
}

/** The fields an issue comment and an inline comment share. */
function commentBase(obj: RawRecord) {
  const user = (firstOf(obj, ['user', 'author']) ?? {}) as RawRecord
  return {
    id: Number(obj.id),
    author: asText(user.login),
    authorAvatarUrl: asText(user.avatar_url),
    body: asText(obj.body),
    createdAt: asText(obj.created_at),
    updatedAt: asText(obj.updated_at),
  }
}

export function mapIssueComment(raw: unknown): IssueComment {
  return commentBase(raw as RawRecord)
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null
  return Number(value)
}

/** A reply joins its parent's thread; a top-level comment starts its own. */
function threadFields(id: number, inReplyTo: number | null) {
  const threadId = String(inReplyTo ?? id)
  return { threadId, isReply: inReplyTo != null, parentId: inReplyTo }
}

export function mapComment(raw: unknown): InlineComment {
  const obj = raw as RawRecord
  const base = commentBase(obj)
  const side: 'LEFT' | 'RIGHT' = upper(obj.side ?? 'RIGHT') === 'LEFT' ? 'LEFT' : 'RIGHT'
  return {
    ...base,
    path: String(obj.path ?? ''),
    line: Number(obj.line ?? 0),
    startLine: optionalNumber(obj.start_line),
    side,
    diffHunk: String(obj.diff_hunk ?? ''),
    outdated: Boolean(obj.outdated),
    ...threadFields(base.id, optionalNumber(obj.in_reply_to_id)),
  }
}

/** The diff line a patch line is, numbered later; null for a file header line. */
function draftLine(line: string): DiffLineDraft | null {
  const content = line.slice(1)
  if (line.startsWith('+++') || line.startsWith('---')) return null
  const blank = { content, oldLineNumber: null, newLineNumber: null }
  if (line.startsWith('+')) return { type: 'add', ...blank }
  if (line.startsWith('-')) return { type: 'remove', ...blank }
  return { type: 'context', ...blank }
}

function hunksFromPatch(raw: string): FileDiff['hunks'] {
  const hunks: FileDiff['hunks'] = []
  const rawLines = raw.split('\n')
  for (const [i, line] of rawLines.entries()) {
    if (line.startsWith('\\')) continue
    if (line === '' && i === rawLines.length - 1) continue
    if (line.startsWith('@@ ')) {
      hunks.push({ header: line, lines: [] })
      continue
    }
    const drafted = hunks.length > 0 ? draftLine(line) : null
    if (drafted) hunks[hunks.length - 1].lines.push(drafted)
  }
  return hunks
}

function numberHunkLines(hunk: FileDiff['hunks'][0]): void {
  const match = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  let oldN = match ? parseInt(match[1], 10) : 1
  let newN = match ? parseInt(match[2], 10) : 1
  for (const dl of hunk.lines) {
    if (dl.type !== 'add') dl.oldLineNumber = oldN++
    if (dl.type !== 'remove') dl.newLineNumber = newN++
  }
}

export function parsePrFileDiff(raw: string, filePath: string): FileDiff {
  if (!raw.trim()) return { path: filePath, hunks: [], isBinary: false, truncated: false }
  if (raw.includes('Binary files')) {
    return { path: filePath, hunks: [], isBinary: true, truncated: false }
  }
  const hunks = hunksFromPatch(raw)
  hunks.forEach(numberHunkLines)
  const result = FileDiffSchema.safeParse({ path: filePath, hunks, isBinary: false })
  if (result.success) return result.data
  return { path: filePath, hunks, isBinary: false, truncated: false }
}
