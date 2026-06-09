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
import type { FileDiff } from '../schemas/git.schema.js'

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
    const matches = line.match(re)
    return acc + (matches ? matches.length : 0)
  }, 0)
}

// ─── Complexity hotspot detection ─────────────────────────────────────────────

export interface ComplexityHotspot {
  hunkIndex: number
  complexityDelta: number
  message: string
}

export function detectComplexityHotspots(diff: FileDiff): ComplexityHotspot[] {
  const hotspots: ComplexityHotspot[] = []

  diff.hunks.forEach((hunk, hunkIndex) => {
    let added = 0
    let removed = 0

    for (const line of hunk.lines) {
      if (line.type === 'add') added += countDecisionPoints(line.content)
      else if (line.type === 'remove') removed += countDecisionPoints(line.content)
    }

    const delta = added - removed
    if (delta >= 5) {
      hotspots.push({
        hunkIndex,
        complexityDelta: delta,
        message: `Complexity hotspot — this block adds ${delta} decision point${delta !== 1 ? 's' : ''} (cyclomatic delta +${delta}).`,
      })
    }
  })

  return hotspots
}

export function computeFileCyclomaticDelta(diff: FileDiff): number {
  return diff.hunks.reduce((total, hunk) => {
    let added = 0
    let removed = 0
    for (const line of hunk.lines) {
      if (line.type === 'add') added += countDecisionPoints(line.content)
      else if (line.type === 'remove') removed += countDecisionPoints(line.content)
    }
    return total + (added - removed)
  }, 0)
}

// ─── Risk score computation ────────────────────────────────────────────────────

const MISSING_TEST_PENALTY = 20

export function computeRiskScore(metrics: FileMetrics, allFilesMetrics: FileMetrics[]): RiskScore {
  function normalise(value: number | null, allValues: (number | null)[]): number | null {
    if (value == null) return null
    const nums = allValues.filter((v): v is number => v != null)
    if (nums.length === 0) return null
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    if (max === min) return 0
    return (value - min) / (max - min)
  }

  const allChurn = allFilesMetrics.map((m) => m.churn90d)
  const allBlast = allFilesMetrics.map((m) => m.blastRadius)
  const allSize = allFilesMetrics.map((m) => m.additions + m.deletions)
  const allComp = allFilesMetrics.map((m) => m.complexityDelta)

  const churn_n = normalise(metrics.churn90d, allChurn)
  const blast_n = normalise(metrics.blastRadius, allBlast)
  const size_n = normalise(metrics.additions + metrics.deletions, allSize)
  const comp_n = normalise(metrics.complexityDelta, allComp)
  const coverage_n = metrics.patchCoverage != null ? 1 - metrics.patchCoverage / 100 : null

  type MetricEntry = { value: number | null; weight: number }
  const entries: MetricEntry[] = [
    { value: churn_n, weight: 0.25 },
    { value: blast_n, weight: 0.25 },
    { value: size_n, weight: 0.2 },
    { value: comp_n, weight: 0.1 },
    { value: coverage_n, weight: 0.05 },
  ]

  const available = entries.filter((e) => e.value != null)
  let composite: number | null = null

  if (available.length >= 2) {
    const totalWeight = available.reduce((s, e) => s + e.weight, 0)
    const weighted = available.reduce((s, e) => s + e.value! * e.weight, 0)
    composite = (weighted / totalWeight) * 80

    if (!metrics.testFilePresent) composite += MISSING_TEST_PENALTY
    composite = Math.min(100, Math.round(composite))
  }

  const contributions: Array<{ label: string; value: number }> = []
  if (churn_n != null && metrics.churn90d != null)
    contributions.push({
      label: `High churn — ${metrics.churn90d} commits/90d`,
      value: churn_n * 0.25,
    })
  if (blast_n != null && metrics.blastRadius != null)
    contributions.push({
      label: `Wide blast radius — ${metrics.blastRadius} importers`,
      value: blast_n * 0.25,
    })
  if (size_n != null)
    contributions.push({
      label: `Large change — ${metrics.additions + metrics.deletions} lines`,
      value: size_n * 0.2,
    })
  if (comp_n != null && metrics.complexityDelta != null && metrics.complexityDelta > 0)
    contributions.push({
      label: `Complexity increase — +${metrics.complexityDelta} decision points`,
      value: comp_n * 0.1,
    })
  if (!metrics.testFilePresent)
    contributions.push({ label: 'Missing test file', value: MISSING_TEST_PENALTY / 100 })

  contributions.sort((a, b) => b.value - a.value)
  const dominantDriver = contributions[0]?.label ?? 'No dominant risk signal'

  const level: 'low' | 'medium' | 'high' =
    composite == null ? 'low' : composite >= 67 ? 'high' : composite >= 34 ? 'medium' : 'low'

  return {
    level,
    composite,
    metrics: {
      changeSize: metrics.additions + metrics.deletions,
      churn90d: metrics.churn90d,
      blastRadius: metrics.blastRadius,
      testFilePresent: metrics.testFilePresent,
      complexityDelta: metrics.complexityDelta,
      patchCoverage: metrics.patchCoverage,
    },
    dominantDriver,
    topImporters: metrics.topImporters.slice(0, 5),
    importerCount: metrics.importerCount,
  }
}

// ─── Chapter building ─────────────────────────────────────────────────────────

function isLockOrGeneratedFile(name: string): boolean {
  // Lock files (all languages)
  if (/\.lock$/.test(name)) return true // *.lock (yarn, Cargo, Gemfile, poetry, etc.)
  if (/package-lock\.json$/.test(name)) return true // npm
  if (/pnpm-lock\.yaml$/.test(name)) return true // pnpm
  if (/packages\.lock\.json$/.test(name)) return true // .NET
  if (/gradle\.lockfile$/.test(name)) return true // Gradle
  if (/Package\.resolved$/.test(name)) return true // Swift
  if (/go\.sum$/.test(name)) return true // Go
  if (/go\.work\.sum$/.test(name)) return true // Go workspaces
  if (/requirements\.txt$/.test(name)) return true // Python (pinned deps)
  if (/constraints\.txt$/.test(name)) return true // Python pip constraints
  if (/shrinkwrap\.json$/.test(name)) return true // npm shrinkwrap
  // Generated / mechanical files
  if (/\.generated\.[^.]+$/.test(name)) return true
  if (/\.snap$/.test(name)) return true // test snapshots
  if (/\.pb\.go$/.test(name)) return true // protobuf Go
  if (/\.pb\.swift$/.test(name)) return true // protobuf Swift
  if (/_pb2\.py$/.test(name)) return true // protobuf Python
  if (/\.pb\.cc$|\.pb\.h$/.test(name)) return true // protobuf C++
  if (/GraphQL\.swift$/.test(name)) return true // Apollo GraphQL generated
  if (/API\.graphql\.swift$/.test(name)) return true
  return false
}

function classifyTier(path: string): 0 | 1 | 2 | 3 {
  const name = path.split('/').pop() ?? path
  if (
    /\.(d\.ts|types?\.ts|interface\.ts)$/.test(name) ||
    name === 'types.ts' ||
    name === 'interfaces.ts' ||
    name === 'index.ts'
  )
    return 0
  // JS/TS test files
  if (/\.(spec|test)\.[^.]+$/.test(name) || path.includes('__tests__/')) return 2
  // Go test files (*_test.go)
  if (/_test\.go$/.test(name)) return 2
  // Python test files (test_*.py, conftest.py)
  if (/^test_.*\.py$/.test(name) || name === 'conftest.py') return 2
  // Ruby test/spec files (*_spec.rb, *_test.rb)
  if (/_(spec|test)\.rb$/.test(name)) return 2
  // Java test files (*Test.java, *Tests.java, *Spec.java)
  if (/Tests?\.java$|Spec\.java$/.test(name)) return 2
  // Swift test files (*Tests.swift, *Spec.swift)
  if (/Tests?\.swift$|Spec\.swift$/.test(name)) return 2
  // Rust tests directory
  if (/^tests\/.*\.rs$/.test(path)) return 2
  if (isLockOrGeneratedFile(name)) return 3
  return 1
}

// Layer score for tier-1 files: higher = more likely a consumer/dependent → shown first.
// Lower = more likely a provider/dependee → shown after its consumers.
function layerScore(path: string): number {
  const stem = (path.split('/').pop() ?? path).toLowerCase().replace(/\.[^.]+$/, '')
  if (/\b(route|router|routing)\b/.test(stem)) return 9
  if (/\b(page|screen|app|main)\b/.test(stem)) return 8
  if (/\b(component|widget|panel|dialog|modal)\b/.test(stem)) return 7
  if (/^use[a-z]/.test(stem) || /\bhook\b/.test(stem)) return 6
  if (/\b(store|slice|context|state)\b/.test(stem)) return 5
  if (/\b(service|handler|controller|api|manager|middleware)\b/.test(stem)) return 4
  if (/\b(repository|gateway|client|adapter)\b/.test(stem)) return 3
  if (/\b(model|entity|domain|schema|validator|dto)\b/.test(stem)) return 2
  if (/\b(util|utils|helper|helpers|lib|common|shared|format|parse|transform)\b/.test(stem))
    return 1
  if (/\b(config|constant|constants|env|settings)\b/.test(stem)) return 1
  return 4
}

function whyHere(tier: 0 | 1 | 2 | 3): string {
  switch (tier) {
    case 0:
      return 'Interface/type file — contract foundation for the source files above'
    case 1:
      return 'Source file — implementation'
    case 2:
      return 'Test file — validates the implementation above'
    case 3:
      return 'Mechanical change — lock file, generated output, or formatting only'
  }
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

// Matches against individual directory segments (not the joined path) to avoid false
// positives like 'test-batch' matching 'tests'. Iterates deepest segment first so
// that e.g. '__tests__' inside 'components/' correctly classifies as Tests, not UI.
function semanticGroupName(filePath: string): string {
  const parts = filePath.split('/')
  // Iterate from deepest to shallowest directory segment (excluding the filename)
  const dirSegments = parts
    .slice(0, -1)
    .map((s) => s.toLowerCase())
    .reverse()
  for (const segment of dirSegments) {
    for (const [pattern, name] of CANONICAL_GROUPS) {
      if (pattern.test(segment)) return name
    }
  }
  return parts.length > 1 ? parts[parts.length - 2] : 'root'
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

function extractImports(patch: string, fromPath: string, knownPaths: Set<string>): string[] {
  const fromDir = fromPath.split('/').slice(0, -1).join('/')
  const found: string[] = []
  IMPORT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMPORT_RE.exec(patch)) !== null) {
    const spec = match[1]
    if (!spec.startsWith('.')) continue
    const resolved = resolvePath(fromDir, spec)
    const hit = [...knownPaths].find(
      (p) => p === resolved || p.startsWith(resolved + '.') || p.startsWith(resolved + '/index.')
    )
    if (hit) found.push(hit)
  }
  return found
}

// ─── Union-find for group merging ──────────────────────────────────────────────

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
    // Lower CANONICAL_GROUPS index = more foundational = wins. Fallback groups lose to canonical ones.
    const ia = CANONICAL_GROUPS.findIndex(([, n]) => n === ra)
    const ib = CANONICAL_GROUPS.findIndex(([, n]) => n === rb)
    const prioA = ia === -1 ? 999 : ia
    const prioB = ib === -1 ? 999 : ib
    if (prioA <= prioB) this.parent.set(rb, ra)
    else this.parent.set(ra, rb)
  }
}

// ─── Three-signal grouping ─────────────────────────────────────────────────────

const MAX_GROUP_SIZE = 15

function groupFilesIntoChapters(
  files: RawFile[],
  coChangeAffinity?: Map<string, string[]>
): Map<string, RawFile[]> {
  const uf = new UnionFind()
  const fileGroup = new Map<string, string>()

  // Signal 1: assign each file to a semantic group
  for (const f of files) {
    fileGroup.set(f.path, semanticGroupName(f.path))
  }

  // Signal 2: merge groups whose files share a feature stem (≥ 3 chars to skip noise)
  const stemToGroups = new Map<string, string[]>()
  for (const [path, group] of fileGroup) {
    const stem = featureStem(path)
    if (stem.length >= 3) {
      const list = stemToGroups.get(stem) ?? []
      list.push(group)
      stemToGroups.set(stem, list)
    }
  }
  for (const groups of stemToGroups.values()) {
    for (let i = 1; i < groups.length; i++) uf.union(groups[0], groups[i])
  }

  // Signal 3: language-agnostic co-change affinity from git history
  if (coChangeAffinity) {
    for (const f of files) {
      const cochanged = coChangeAffinity.get(f.path) ?? []
      for (const other of cochanged) {
        const ga = fileGroup.get(f.path)
        const gb = fileGroup.get(other)
        if (ga && gb) uf.union(ga, gb)
      }
    }
  }

  // Signal 3b: JS/TS import graph — merge groups connected by direct imports in patch text
  const knownPaths = new Set(files.map((f) => f.path))
  for (const f of files) {
    if (!f.patch) continue
    for (const imported of extractImports(f.patch, f.path, knownPaths)) {
      const ga = fileGroup.get(f.path)
      const gb = fileGroup.get(imported)
      if (ga && gb) uf.union(ga, gb)
    }
  }

  // Collect files by canonical group
  const groups = new Map<string, RawFile[]>()
  for (const f of files) {
    const canonical = uf.find(fileGroup.get(f.path)!)
    const list = groups.get(canonical) ?? []
    list.push(f)
    groups.set(canonical, list)
  }

  // Sub-split any group that still exceeds MAX_GROUP_SIZE (by directory depth)
  const result = new Map<string, RawFile[]>()
  for (const [key, groupFiles] of groups) {
    if (groupFiles.length <= MAX_GROUP_SIZE) {
      result.set(key, groupFiles)
    } else {
      // Split by immediate parent directory, prefixed with the semantic group key
      const byDir = new Map<string, RawFile[]>()
      for (const f of groupFiles) {
        const parts = f.path.split('/')
        const dir = parts.length > 1 ? parts[parts.length - 2] : 'root'
        const subKey = `${key} / ${dir}`
        const list = byDir.get(subKey) ?? []
        list.push(f)
        byDir.set(subKey, list)
      }
      for (const [subKey, subFiles] of byDir) result.set(subKey, subFiles)
    }
  }

  return result
}

interface RawFile {
  path: string
  additions: number
  deletions: number
  changeType?: string
  patch?: string
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

export function buildChapters(
  rawFiles: unknown[],
  overrides?: Record<string, string[]>,
  coChangeAffinity?: Map<string, string[]>
): Chapter[] {
  const files: RawFile[] = rawFiles
    .map((f) => {
      const obj = f as Record<string, unknown>
      return {
        path: String(obj.path ?? obj.filename ?? ''),
        additions: Number(obj.additions ?? 0),
        deletions: Number(obj.deletions ?? 0),
        changeType: String(obj.changeType ?? obj.status ?? 'modified'),
        patch: obj.patch ? String(obj.patch) : undefined,
      }
    })
    .filter((f) => f.path.length > 0)

  if (files.length === 0) return []

  const groups = groupFilesIntoChapters(files, coChangeAffinity)

  const chapters: Chapter[] = []

  const buildGroupChapter = (groupKey: string, groupFiles: RawFile[]) => {
    const byTier = new Map<0 | 1 | 2 | 3, RawFile[]>()
    for (const f of groupFiles) {
      const tier = classifyTier(f.path)
      const existing = byTier.get(tier) ?? []
      existing.push(f)
      byTier.set(tier, existing)
    }

    // Order: tier 1 (consumers/implementation) first sorted by layer desc then size desc,
    // then tier 0 (types/interfaces — what implementation depends on),
    // then tier 2 (tests), then tier 3 (mechanical).
    const tier1 = [...(byTier.get(1) ?? [])].sort((a, b) => {
      const ld = layerScore(b.path) - layerScore(a.path)
      if (ld !== 0) return ld
      return b.additions + b.deletions - (a.additions + a.deletions)
    })
    const tier0 = byTier.get(0) ?? []
    const tier2 = byTier.get(2) ?? []
    const tier3 = byTier.get(3) ?? []

    const tieredFiles: PrChangedFile[] = []
    for (const [tFiles, tier] of [
      [tier1, 1],
      [tier0, 0],
      [tier2, 2],
      [tier3, 3],
    ] as [RawFile[], 0 | 1 | 2 | 3][]) {
      for (const f of tFiles) {
        tieredFiles.push({
          path: f.path,
          changeType: mapChangeType(f.changeType ?? 'modified'),
          additions: f.additions,
          deletions: f.deletions,
          isBinary: false,
          tier,
          whyHere: whyHere(tier),
          riskScore: defaultRiskScore(),
          estimatedMinutes: Math.max(1, Math.ceil((f.additions + f.deletions) / 60)),
        })
      }
    }

    const chapterId = groupKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const ordered = applyOverrides(tieredFiles, overrides?.[chapterId])

    chapters.push({
      id: chapterId,
      name: groupKey,
      files: ordered,
      estimatedMinutes: ordered.reduce((s, f) => s + f.estimatedMinutes, 0),
      status: 'not-started',
    })
  }

  const regularGroups: [string, RawFile[]][] = []
  const mechanicalGroups: [string, RawFile[]][] = []

  for (const [key, groupFiles] of groups) {
    const allMech = groupFiles.every((f) => classifyTier(f.path) === 3)
    if (allMech) mechanicalGroups.push([key, groupFiles])
    else regularGroups.push([key, groupFiles])
  }

  for (const [key, groupFiles] of regularGroups) buildGroupChapter(key, groupFiles)
  for (const [key, groupFiles] of mechanicalGroups) buildGroupChapter(key, groupFiles)

  return chapters
}

function applyOverrides(files: PrChangedFile[], order?: string[]): PrChangedFile[] {
  if (!order || order.length === 0) return files
  const fileMap = new Map(files.map((f) => [f.path, f]))
  const ordered: PrChangedFile[] = []
  for (const path of order) {
    const f = fileMap.get(path)
    if (f) {
      ordered.push(f)
      fileMap.delete(path)
    }
  }
  for (const f of fileMap.values()) ordered.push(f)
  return ordered
}

function mapChangeType(raw: string): PrChangedFile['changeType'] {
  switch (raw.toLowerCase()) {
    case 'added':
      return 'added'
    case 'removed':
    case 'deleted':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    default:
      return 'modified'
  }
}

// ─── Queue PR parsing ─────────────────────────────────────────────────────────

const LINT_NAMES = ['lint', 'eslint', 'rubocop', 'flake8', 'pylint', 'stylelint', 'tslint']
const COVERAGE_NAMES = ['coverage', 'codecov', 'coveralls', 'sonar', 'codeclimate', 'lcov']

type SignalValue = 'pass' | 'warn' | 'fail' | 'unknown'

// Non-blocking conclusions that don't count as success or failure

function checkSignal(rollup: unknown, keywords: string[]): SignalValue {
  if (!rollup || !Array.isArray(rollup)) return 'unknown'
  const checks = (rollup as Array<Record<string, unknown>>).filter((s) => {
    const name = String(s.name ?? s.context ?? '').toLowerCase()
    return keywords.some((k) => name.includes(k))
  })
  if (checks.length === 0) return 'unknown'
  const states = checks.map((s) => String(s.state ?? s.conclusion ?? '').toUpperCase())
  if (
    states.some(
      (s) => s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT' || s === 'ACTION_REQUIRED'
    )
  )
    return 'fail'
  if (states.some((s) => s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED')) return 'warn'
  if (states.some((s) => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

function ciSignal(rollup: unknown): SignalValue {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'unknown'
  const states = (rollup as Array<Record<string, unknown>>).map((s) =>
    String(s.state ?? s.conclusion ?? '').toUpperCase()
  )
  if (
    states.some(
      (s) => s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT' || s === 'ACTION_REQUIRED'
    )
  )
    return 'fail'
  if (states.some((s) => s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED')) return 'warn'
  // SKIPPED/NEUTRAL/CANCELLED are non-blocking — pass if at least one check succeeded
  if (states.some((s) => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

function testsSignal(filePaths: string[]): SignalValue {
  if (filePaths.length === 0) return 'unknown'
  const sourceFiles = filePaths.filter(
    (p) =>
      /\.(ts|tsx|js|jsx|py|rb|go|java|cs)$/.test(p) &&
      !/\.(spec|test)\.[^.]+$/.test(p) &&
      !p.includes('__tests__')
  )
  if (sourceFiles.length === 0) return 'unknown'
  const testFiles = new Set(
    filePaths.filter((p) => /\.(spec|test)\.[^.]+$/.test(p) || p.includes('__tests__'))
  )
  if (testFiles.size === 0) return 'fail'
  // Check if source files have corresponding test files in the PR
  const covered = sourceFiles.filter((src) => {
    const stem = src.replace(/\.[^.]+$/, '').replace(/\/index$/, '')
    return [...testFiles].some((t) => t.includes(stem.split('/').pop()!))
  })
  if (covered.length === 0) return 'warn'
  return covered.length >= sourceFiles.length / 2 ? 'pass' : 'warn'
}

function churnSignal(totalLines: number, fileCount: number): SignalValue {
  if (fileCount === 0) return 'unknown'
  const perFile = totalLines / fileCount
  return perFile > 200 ? 'fail' : perFile > 80 ? 'warn' : 'pass'
}

function blastSignal(fileCount: number): SignalValue {
  return fileCount > 15 ? 'fail' : fileCount > 6 ? 'warn' : 'pass'
}

export function parseReviewQueuePR(raw: unknown): ReviewQueuePR {
  const obj = raw as Record<string, unknown>
  const rawFiles = (obj.files as unknown[] | undefined) ?? []
  const fileCount = rawFiles.length > 0 ? rawFiles.length : Number(obj.changedFiles ?? 0)
  const additions =
    rawFiles.length > 0
      ? rawFiles.reduce((s, f) => s + Number((f as Record<string, unknown>).additions ?? 0), 0)
      : Number(obj.additions ?? 0)
  const deletions =
    rawFiles.length > 0
      ? rawFiles.reduce((s, f) => s + Number((f as Record<string, unknown>).deletions ?? 0), 0)
      : Number(obj.deletions ?? 0)
  const filePaths = rawFiles.map((f) =>
    String((f as Record<string, unknown>).path ?? (f as Record<string, unknown>).filename ?? '')
  )
  const rollup = obj.statusCheckRollup

  const signalDots: SignalDots = {
    tests: testsSignal(filePaths),
    coverage: checkSignal(rollup, COVERAGE_NAMES),
    ci: ciSignal(rollup),
    lint: checkSignal(rollup, LINT_NAMES),
    churn: churnSignal(additions + deletions, fileCount),
    blast: blastSignal(fileCount),
  }

  const ciSt = ciSignal(rollup)
  const ciStatus: ReviewQueuePR['ciStatus'] =
    ciSt === 'pass' ? 'passing' : ciSt === 'fail' ? 'failing' : ciSt === 'warn' ? 'pending' : 'none'

  // Extract approvals from REST `reviews` field or GraphQL `latestReviews.nodes`
  const rawReviews =
    (obj.reviews as unknown[] | undefined) ??
    (obj.latestReviews as { nodes?: unknown[] } | undefined)?.nodes ??
    []
  const approvedBy = [
    ...new Set(
      (rawReviews as Array<Record<string, unknown>>)
        .filter((r) => String(r.state ?? '').toUpperCase() === 'APPROVED')
        .map((r) => {
          const author = (r.author as Record<string, unknown>) ?? {}
          return String(author.login ?? '')
        })
        .filter(Boolean)
    ),
  ]

  // Extract requested reviewers (already flattened by normalizeGraphQLNode or raw REST field)
  const requestedReviewers: string[] = Array.isArray(obj.requestedReviewers)
    ? (obj.requestedReviewers as string[])
    : []

  // Extract assignees (flattened by normalizeGraphQLNode or REST assignees field)
  const assigneeLogins: string[] = Array.isArray(obj.assigneeLogins)
    ? (obj.assigneeLogins as string[])
    : Array.isArray(obj.assignees)
      ? (obj.assignees as Array<Record<string, unknown>>)
          .map((a) => String(a.login ?? ''))
          .filter(Boolean)
      : []

  return {
    number: Number(obj.number),
    title: String(obj.title ?? ''),
    author: String((obj.author as Record<string, unknown>)?.login ?? ''),
    authorAvatarUrl: String((obj.author as Record<string, unknown>)?.avatarUrl ?? ''),
    openedAt: String(obj.createdAt ?? ''),
    headRefName: String(obj.headRefName ?? ''),
    baseRefName: String(obj.baseRefName ?? ''),
    isDraft: Boolean(obj.isDraft),
    ciStatus,
    fileCount,
    additions,
    deletions,
    estimatedMinutes: Math.max(1, Math.ceil((additions + deletions) / 60)),
    riskLevel: 'low',
    signalDots,
    sessionStatus: 'not-started',
    approvalCount: approvedBy.length,
    approvedBy,
    requestedReviewers,
    assigneeLogins,
    mergeStateStatus: (() => {
      const s = String(obj.mergeStateStatus ?? '').toUpperCase()
      if (s === 'BEHIND') return 'behind' as const
      if (s === 'DIRTY') return 'dirty' as const
      if (s === 'CLEAN' || s === 'HAS_HOOKS') return 'clean' as const
      return 'unknown' as const
    })(),
  }
}

// ─── Force-push changed-file detection ───────────────────────────────────────

export function chapterRiskLevel(chapter: Chapter): 'low' | 'medium' | 'high' {
  const scoreable = chapter.files.filter((f) => f.tier !== 3)
  if (scoreable.some((f) => f.riskScore.level === 'high')) return 'high'
  if (scoreable.some((f) => f.riskScore.level === 'medium')) return 'medium'
  return 'low'
}

export function detectChangedFiles(
  oldFiles: PrChangedFile[],
  newFiles: PrChangedFile[]
): Set<string> {
  const oldMap = new Map(oldFiles.map((f) => [f.path, f]))
  const changed = new Set<string>()
  for (const newFile of newFiles) {
    const old = oldMap.get(newFile.path)
    if (!old) {
      changed.add(newFile.path)
    } else if (old.additions !== newFile.additions || old.deletions !== newFile.deletions) {
      changed.add(newFile.path)
    }
  }
  return changed
}

// ─── Hunk classification (formatting vs semantic) ─────────────────────────────

export function classifyHunk(hunk: {
  lines: Array<{ type: string; content: string }>
}): 'semantic' | 'formatting' {
  const added = hunk.lines.filter((l) => l.type === 'add').map((l) => l.content.trim())
  const removed = hunk.lines.filter((l) => l.type === 'remove').map((l) => l.content.trim())

  // No actual changes in this hunk — just context lines; treat as semantic (don't filter)
  if (added.length === 0 && removed.length === 0) return 'semantic'
  if (added.length !== removed.length) return 'semantic'

  // Check multiset equality: if stripped add lines == stripped remove lines, it's formatting
  const counts = new Map<string, number>()
  for (const line of added) counts.set(line, (counts.get(line) ?? 0) + 1)
  for (const line of removed) counts.set(line, (counts.get(line) ?? 0) - 1)
  return [...counts.values()].every((v) => v === 0) ? 'formatting' : 'semantic'
}

// ─── Issue reference extraction ───────────────────────────────────────────────

export function extractIssueRefs(body: string): IssueRef[] {
  const refs: IssueRef[] = []
  // GitHub: Fixes #123, Closes #456, Resolves #789, Related #012
  const ghRe = /(?:fixes|closes|resolves|related)\s+#(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = ghRe.exec(body)) !== null) {
    refs.push({ type: 'github', ref: `#${m[1]}` })
  }
  // Linear: https://linear.app/team/issue/TEAM-123
  const linearRe = /https?:\/\/linear\.app\/[^\s/]+\/issue\/([A-Z]+-\d+)/g
  while ((m = linearRe.exec(body)) !== null) {
    refs.push({ type: 'linear', ref: m[1], url: m[0] })
  }
  return refs
}

// ─── DRY violation detection ──────────────────────────────────────────────────

function normalizeForDry(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/['"`]/g, '"')
    .replace(/\b[a-z_][a-zA-Z0-9_]*\b/g, 'X')
    .replace(/\d+/g, 'N')
    .trim()
}

export function detectDryViolations(
  files: Array<{ path: string; patch?: string }>
): DryViolation[] {
  const WINDOW = 5
  const fingerprints = new Map<string, Set<string>>()

  for (const file of files) {
    if (!file.patch) continue
    const addedLines = file.patch
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => normalizeForDry(l.slice(1)))
      .filter((l) => l.length > 10)

    for (let i = 0; i <= addedLines.length - WINDOW; i++) {
      const block = addedLines.slice(i, i + WINDOW).join('\n')
      const existing = fingerprints.get(block) ?? new Set<string>()
      existing.add(file.path)
      fingerprints.set(block, existing)
    }
  }

  const violations: DryViolation[] = []
  for (const [fingerprint, fileSet] of fingerprints) {
    if (fileSet.size >= 2) {
      violations.push({ files: [...fileSet], fingerprint, lineCount: WINDOW })
    }
  }
  return violations
}
