import type { Chapter, PrChangedFile, RiskScore, FileMetrics, ReviewQueuePR } from '../schemas/pr-review.schema.js'
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
    let added = 0; let removed = 0
    for (const line of hunk.lines) {
      if (line.type === 'add') added += countDecisionPoints(line.content)
      else if (line.type === 'remove') removed += countDecisionPoints(line.content)
    }
    return total + (added - removed)
  }, 0)
}

// ─── Risk score computation ────────────────────────────────────────────────────

const MISSING_TEST_PENALTY = 20

export function computeRiskScore(
  metrics: FileMetrics,
  allFilesMetrics: FileMetrics[],
): RiskScore {
  function normalise(value: number | null, allValues: (number | null)[]): number | null {
    if (value == null) return null
    const nums = allValues.filter((v): v is number => v != null)
    if (nums.length === 0) return null
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    if (max === min) return 0
    return (value - min) / (max - min)
  }

  const allChurn = allFilesMetrics.map(m => m.churn90d)
  const allBlast = allFilesMetrics.map(m => m.blastRadius)
  const allSize  = allFilesMetrics.map(m => m.additions + m.deletions)
  const allComp  = allFilesMetrics.map(m => m.complexityDelta)

  const churn_n    = normalise(metrics.churn90d, allChurn)
  const blast_n    = normalise(metrics.blastRadius, allBlast)
  const size_n     = normalise(metrics.additions + metrics.deletions, allSize)
  const comp_n     = normalise(metrics.complexityDelta, allComp)
  const coverage_n = metrics.patchCoverage != null
    ? 1 - (metrics.patchCoverage / 100)
    : null

  type MetricEntry = { value: number | null; weight: number }
  const entries: MetricEntry[] = [
    { value: churn_n, weight: 0.25 },
    { value: blast_n, weight: 0.25 },
    { value: size_n,  weight: 0.20 },
    { value: comp_n,  weight: 0.10 },
    { value: coverage_n, weight: 0.05 },
  ]

  const available = entries.filter(e => e.value != null)
  let composite: number | null = null

  if (available.length >= 2) {
    const totalWeight = available.reduce((s, e) => s + e.weight, 0)
    const weighted = available.reduce((s, e) => s + (e.value! * e.weight), 0)
    composite = (weighted / totalWeight) * 80

    if (!metrics.testFilePresent) composite += MISSING_TEST_PENALTY
    composite = Math.min(100, Math.round(composite))
  }

  const contributions: Array<{ label: string; value: number }> = []
  if (churn_n != null && metrics.churn90d != null)
    contributions.push({ label: `High churn — ${metrics.churn90d} commits/90d`, value: churn_n * 0.25 })
  if (blast_n != null && metrics.blastRadius != null)
    contributions.push({ label: `Wide blast radius — ${metrics.blastRadius} importers`, value: blast_n * 0.25 })
  if (size_n != null)
    contributions.push({ label: `Large change — ${metrics.additions + metrics.deletions} lines`, value: size_n * 0.20 })
  if (comp_n != null && metrics.complexityDelta != null && metrics.complexityDelta > 0)
    contributions.push({ label: `Complexity increase — +${metrics.complexityDelta} decision points`, value: comp_n * 0.10 })
  if (!metrics.testFilePresent)
    contributions.push({ label: 'Missing test file', value: MISSING_TEST_PENALTY / 100 })

  contributions.sort((a, b) => b.value - a.value)
  const dominantDriver = contributions[0]?.label ?? 'No dominant risk signal'

  const level: 'low' | 'medium' | 'high' =
    composite == null ? 'low'
    : composite >= 67 ? 'high'
    : composite >= 34 ? 'medium'
    : 'low'

  return {
    level,
    composite,
    metrics: {
      changeSize:      metrics.additions + metrics.deletions,
      churn90d:        metrics.churn90d,
      blastRadius:     metrics.blastRadius,
      testFilePresent: metrics.testFilePresent,
      complexityDelta: metrics.complexityDelta,
      patchCoverage:   metrics.patchCoverage,
    },
    dominantDriver,
    topImporters:  metrics.topImporters.slice(0, 5),
    importerCount: metrics.importerCount,
  }
}

// ─── Chapter building ─────────────────────────────────────────────────────────

function classifyTier(path: string): 0 | 1 | 2 | 3 {
  const name = path.split('/').pop() ?? path
  if (
    /\.(d\.ts|types?\.ts|interface\.ts)$/.test(name) ||
    name === 'types.ts' || name === 'interfaces.ts' || name === 'index.ts'
  ) return 0
  if (/\.(spec|test)\.[^.]+$/.test(name) || path.includes('__tests__/')) return 2
  if (
    /package-lock\.json$/.test(name) ||
    /\.lock$/.test(name) ||
    /\.generated\.[^.]+$/.test(name) ||
    /\.snap$/.test(name)
  ) return 3
  return 1
}

function whyHere(tier: 0 | 1 | 2 | 3): string {
  switch (tier) {
    case 0: return 'Interface/type file — defines contracts used by the files below'
    case 1: return 'Source file — implementation; read after type definitions'
    case 2: return 'Test file — validates the implementation above'
    case 3: return 'Mechanical change — lock file, generated output, or formatting only'
  }
}

function chapterName(paths: string[]): string {
  if (paths.length === 0) return 'Changes'
  const segments = paths.map(p => p.split('/'))
  const depth = Math.min(...segments.map(s => s.length)) - 1
  for (let d = depth; d >= 1; d--) {
    const prefix = segments[0].slice(0, d).join('/')
    if (segments.every(s => s.slice(0, d).join('/') === prefix)) return prefix
  }
  return segments[0][0] ?? 'Changes'
}

interface RawFile {
  path: string
  additions: number
  deletions: number
  changeType?: string
}

function defaultRiskScore(): RiskScore {
  return {
    level: 'low',
    composite: null,
    metrics: { changeSize: null, churn90d: null, blastRadius: null, testFilePresent: null, complexityDelta: null, patchCoverage: null },
    dominantDriver: 'Not yet computed',
    topImporters: [],
    importerCount: 0,
  }
}

export function buildChapters(
  rawFiles: unknown[],
  overrides?: Record<string, string[]>,
): Chapter[] {
  const files: RawFile[] = rawFiles.map(f => {
    const obj = f as Record<string, unknown>
    return {
      path:       String(obj.path ?? obj.filename ?? ''),
      additions:  Number(obj.additions ?? 0),
      deletions:  Number(obj.deletions ?? 0),
      changeType: String(obj.changeType ?? obj.status ?? 'modified'),
    }
  }).filter(f => f.path.length > 0)

  if (files.length === 0) return []

  const groups = new Map<string, RawFile[]>()
  for (const file of files) {
    const parts = file.path.split('/')
    const groupKey = parts.length > 1 ? parts[0] : '.'
    const existing = groups.get(groupKey) ?? []
    existing.push(file)
    groups.set(groupKey, existing)
  }

  const chapters: Chapter[] = []
  const groupEntries = [...groups.entries()]

  const buildGroupChapters = (groupKey: string, groupFiles: RawFile[]) => {
    const byTier = new Map<0 | 1 | 2 | 3, RawFile[]>()
    for (const f of groupFiles) {
      const tier = classifyTier(f.path)
      const existing = byTier.get(tier) ?? []
      existing.push(f)
      byTier.set(tier, existing)
    }

    const tieredFiles: PrChangedFile[] = []
    for (const tier of [0, 1, 2, 3] as const) {
      const tFiles = byTier.get(tier) ?? []
      const sorted = tier === 1
        ? [...tFiles].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
        : tFiles
      for (const f of sorted) {
        tieredFiles.push({
          path:             f.path,
          changeType:       mapChangeType(f.changeType ?? 'modified'),
          additions:        f.additions,
          deletions:        f.deletions,
          isBinary:         false,
          tier,
          whyHere:          whyHere(tier),
          riskScore:        defaultRiskScore(),
          estimatedMinutes: Math.max(1, Math.ceil((f.additions + f.deletions) / 60)),
        })
      }
    }

    const chapterId = groupKey === '.' ? 'root' : groupKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const ordered = applyOverrides(tieredFiles, overrides?.[chapterId])

    chapters.push({
      id:               chapterId,
      name:             groupKey === '.' ? chapterName(groupFiles.map(f => f.path)) : groupKey,
      files:            ordered,
      estimatedMinutes: ordered.reduce((s, f) => s + f.estimatedMinutes, 0),
      status:           'not-started',
    })
  }

  const regularGroups: [string, RawFile[]][] = []
  const mechanicalGroups: [string, RawFile[]][] = []

  for (const entry of groupEntries) {
    const allMech = entry[1].every(f => classifyTier(f.path) === 3)
    if (allMech) mechanicalGroups.push(entry)
    else regularGroups.push(entry)
  }

  for (const [key, files] of regularGroups) buildGroupChapters(key, files)
  for (const [key, files] of mechanicalGroups) buildGroupChapters(key, files)

  return chapters
}

function applyOverrides(files: PrChangedFile[], order?: string[]): PrChangedFile[] {
  if (!order || order.length === 0) return files
  const fileMap = new Map(files.map(f => [f.path, f]))
  const ordered: PrChangedFile[] = []
  for (const path of order) {
    const f = fileMap.get(path)
    if (f) { ordered.push(f); fileMap.delete(path) }
  }
  for (const f of fileMap.values()) ordered.push(f)
  return ordered
}

function mapChangeType(raw: string): PrChangedFile['changeType'] {
  switch (raw.toLowerCase()) {
    case 'added':    return 'added'
    case 'removed':
    case 'deleted':  return 'deleted'
    case 'renamed':  return 'renamed'
    default:         return 'modified'
  }
}

// ─── Queue PR parsing ─────────────────────────────────────────────────────────

export function parseReviewQueuePR(raw: unknown): ReviewQueuePR {
  const obj = raw as Record<string, unknown>
  const files  = (obj.files as unknown[] | undefined) ?? []
  const fileCount  = files.length
  const additions  = files.reduce((s, f) => s + Number((f as Record<string,unknown>).additions ?? 0), 0)
  const deletions  = files.reduce((s, f) => s + Number((f as Record<string,unknown>).deletions ?? 0), 0)

  return {
    number:             Number(obj.number),
    title:              String(obj.title ?? ''),
    author:             String((obj.author as Record<string,unknown>)?.login ?? ''),
    authorAvatarUrl:    String((obj.author as Record<string,unknown>)?.avatarUrl ?? ''),
    openedAt:           String(obj.createdAt ?? ''),
    headRefName:        String(obj.headRefName ?? ''),
    baseRefName:        String(obj.baseRefName ?? ''),
    isDraft:            Boolean(obj.isDraft),
    ciStatus:           'none',
    fileCount,
    additions,
    deletions,
    estimatedMinutes:   Math.max(1, Math.ceil((additions + deletions) / 60)),
    riskLevel:          'low',
    signalDots: {
      tests:    'unknown',
      coverage: 'unknown',
      ci:       'unknown',
      lint:     'unknown',
      churn:    'unknown',
      blast:    'unknown',
    },
    sessionStatus: 'not-started',
  }
}

// ─── Force-push changed-file detection ───────────────────────────────────────

export function detectChangedFiles(
  oldFiles: PrChangedFile[],
  newFiles: PrChangedFile[],
): Set<string> {
  const oldMap = new Map(oldFiles.map(f => [f.path, f]))
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
