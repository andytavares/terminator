import React from 'react'
import { ArrowRight, Check, Info, RotateCcw, X } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import type { ConflictFile, ConflictSession } from '../../schemas/merge-flow.schema'
import { choose, plural, splitPath } from '../text'

interface Props {
  onSelectFile: (fileIndex: number) => void
  onStartOver?: () => void
  onExit?: () => void
}

interface LangBadge {
  label: string
  bg: string
  text: string
}

function badge(label: string, bg: string): LangBadge {
  return { label, bg, text: '#fff' }
}

const LANG_BADGES = new Map<string, LangBadge>([
  ['ts', badge('TS', '#2563eb')],
  ['tsx', badge('TS', '#2563eb')],
  ['js', badge('JS', '#a16207')],
  ['jsx', badge('JS', '#a16207')],
  ['mjs', badge('JS', '#a16207')],
  ['py', badge('PY', '#1d4ed8')],
  ['rb', badge('RB', '#dc2626')],
  ['go', badge('GO', '#155e75')],
  ['rs', badge('RS', '#c2410c')],
  ['java', badge('JV', '#b45309')],
  ['json', badge('{ }', '#0e7490')],
  ['css', badge('CSS', '#db2777')],
  ['scss', badge('CSS', '#db2777')],
  ['md', badge('MD', '#6b7280')],
  ['yaml', badge('YML', '#7c3aed')],
  ['yml', badge('YML', '#7c3aed')],
  ['sh', badge('SH', '#374151')],
  ['sql', badge('SQL', '#0f766e')],
  ['html', badge('HTML', '#9a3412')],
])

function getLangBadge(filePath: string): LangBadge {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return badge('DO', '#0369a1')
  const ext = name.split('.').pop() ?? ''
  return LANG_BADGES.get(ext) ?? badge(ext.slice(0, 3).toUpperCase() || '?', '#4b5563')
}

function getDotColor(file: ConflictFile): string {
  if (file.resolvedCount >= file.conflictCount) return 'var(--tm-success)'
  if (file.conflictCount >= 4) return '#ef4444'
  if (file.conflictCount >= 2) return '#f59e0b'
  return '#6b7280'
}

interface FileCardProps {
  file: ConflictFile
  index: number
  isFirst: boolean
  isResolved: boolean
  oursBranch?: string
  theirsBranch?: string
  onSelectFile: (i: number) => void
}

/** "Ana (main)", or just the name when the branch is unknown. */
function authorLabel(name: string, branch: string | undefined): string {
  if (!branch) return name
  return `${name} (${branch})`
}

function cardClass(card: FileCardProps): string {
  const highlighted = choose(
    card.isFirst && !card.isResolved,
    ' conflict-hub__file-card--highlighted',
    ''
  )
  const resolved = choose(card.isResolved, ' conflict-hub__file-card--resolved', '')
  return `conflict-hub__file-card${highlighted}${resolved}`
}

function conflictBadgeClass(conflictCount: number): string {
  if (conflictCount >= 4) return 'conflict-hub__conflict-badge conflict-hub__conflict-badge--high'
  if (conflictCount >= 2) return 'conflict-hub__conflict-badge conflict-hub__conflict-badge--med'
  return 'conflict-hub__conflict-badge'
}

function CountTag({ file, isResolved }: { file: ConflictFile; isResolved: boolean }) {
  const count = file.conflictCount
  if (isResolved) {
    return (
      <span className="conflict-hub__resolved-tag">
        {count} {plural(count, 'conflict')} · resolved
      </span>
    )
  }
  const remaining = count - file.resolvedCount
  return (
    <span className={conflictBadgeClass(count)}>
      {remaining} {plural(remaining, 'conflict')}
    </span>
  )
}

function FileInfo({ card }: { card: FileCardProps }) {
  const { file } = card
  const { dir, name } = splitPath(file.filePath)
  const ours = authorLabel(file.oursAuthor.name, card.oursBranch)
  const theirs = authorLabel(file.theirsAuthor.name, card.theirsBranch)
  return (
    <div className="conflict-hub__file-info">
      <span className="conflict-hub__file-path">
        <span className="conflict-hub__file-dir">{dir}</span>
        <span className="conflict-hub__file-name">{name}</span>
      </span>
      <span className="conflict-hub__file-authors">
        Modified by {ours} · {theirs}
      </span>
      {file.conflictDescription && (
        <span className="conflict-hub__file-desc">{file.conflictDescription}</span>
      )}
    </div>
  )
}

function FileCard(props: FileCardProps) {
  const { file, index, isResolved, onSelectFile } = props
  const langBadge = getLangBadge(file.filePath)
  const dotColor = choose(isResolved, 'var(--tm-success)', getDotColor(file))
  return (
    <div
      data-testid="conflict-file-row"
      className={cardClass(props)}
      role="button"
      tabIndex={0}
      onClick={() => onSelectFile(index)}
      onKeyDown={(e) => e.key === 'Enter' && onSelectFile(index)}
    >
      <span className="conflict-hub__file-dot" style={{ background: dotColor }}>
        {isResolved && <Check aria-hidden="true" />}
      </span>
      <span
        className="conflict-hub__lang-badge"
        style={{ background: langBadge.bg, color: langBadge.text }}
      >
        {langBadge.label}
      </span>
      <FileInfo card={props} />
      <CountTag file={file} isResolved={isResolved} />
    </div>
  )
}

function sessionBranchNames(session: ConflictSession): { ours: string; theirs: string } {
  const fallback = choose(session.isRebase, 'upstream', 'incoming')
  return { ours: session.oursBranch ?? 'HEAD', theirs: session.theirsBranch ?? fallback }
}

function HubTopBar({ session, hub }: { session: ConflictSession; hub: Props }) {
  const branches = sessionBranchNames(session)
  return (
    <div className="conflict-hub__topbar">
      <div className="conflict-hub__brand">
        <span className="conflict-hub__brand-name">Conflict Solver</span>
      </div>
      <div className="conflict-hub__branch-crumb">
        <span className="conflict-hub__branch">{branches.ours}</span>
        <ArrowRight aria-hidden="true" className="conflict-hub__branch-arrow" />
        <span className="conflict-hub__branch">{branches.theirs}</span>
      </div>
      {session.isRebase && <span className="conflict-hub__rebase-badge">rebase</span>}
      {hub.onStartOver && session.totalResolved > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          onClick={hub.onStartOver}
          title="Reset all resolutions and start over"
        >
          Start over
        </Button>
      )}
      {hub.onExit && <IconButton icon={X} label="Exit merge flow" onClick={hub.onExit} />}
    </div>
  )
}

function Stat(props: { value: React.ReactNode; label: string; tone?: string }) {
  const tone = choose(props.tone, ` conflict-hub__stat-value--${props.tone}`, '')
  return (
    <div className="conflict-hub__stat">
      <span className={`conflict-hub__stat-value${tone}`}>{props.value}</span>
      <span className="conflict-hub__stat-label">{props.label}</span>
    </div>
  )
}

function resolvedPercent(session: ConflictSession): number {
  if (session.totalConflicts <= 0) return 0
  return Math.round((session.totalResolved / session.totalConflicts) * 100)
}

function Progress({ session }: { session: ConflictSession }) {
  return (
    <div className="conflict-hub__progress">
      <span className="conflict-hub__progress-label">Progress</span>
      <div className="conflict-hub__progress-bar">
        <div
          className="conflict-hub__progress-fill"
          style={{ width: `${resolvedPercent(session)}%` }}
        />
      </div>
      <span className="conflict-hub__progress-count">
        {session.totalResolved} of {session.totalConflicts} resolved
      </span>
    </div>
  )
}

function Hero({ session }: { session: ConflictSession }) {
  const branches = sessionBranchNames(session)
  const estimatedMin = Math.max(1, Math.ceil(session.totalConflicts * 0.75))
  return (
    <div className="conflict-hub__hero">
      <h2 className="conflict-hub__hero-title">Merge conflicts need resolving</h2>
      <p className="conflict-hub__hero-subtitle">
        {branches.theirs} cannot be merged into {branches.ours} until these are resolved
      </p>
      <div className="conflict-hub__stats">
        <Stat value={session.files.length} label="Files conflicted" />
        <Stat value={session.totalConflicts} label="Total conflicts" tone="accent" />
        <Stat value={`~${estimatedMin} min`} label="Estimated time" tone="muted" />
      </div>
      <Progress session={session} />
    </div>
  )
}

function Hint() {
  return (
    <div className="conflict-hub__hint">
      <Info aria-hidden="true" className="conflict-hub__hint-icon" />
      <span>
        <strong>Start with the highlighted file.</strong> MergeFlow orders by complexity — hardest
        first while you&apos;re fresh. You can jump to any file at any time.
      </span>
    </div>
  )
}

interface FileSectionProps {
  label: string
  files: ConflictFile[]
  resolved: boolean
  session: ConflictSession
  onSelectFile: Props['onSelectFile']
}

function FileSection({ section }: { section: FileSectionProps }) {
  const { files, session } = section
  return (
    <div className="conflict-hub__section">
      <div className="conflict-hub__section-label">{section.label}</div>
      {files.map((file) => (
        <FileCard
          key={file.filePath}
          file={file}
          index={session.files.indexOf(file)}
          isFirst={!section.resolved && file === files[0]}
          isResolved={section.resolved}
          oursBranch={session.oursBranch}
          theirsBranch={session.theirsBranch}
          onSelectFile={section.onSelectFile}
        />
      ))}
    </div>
  )
}

function FileSections({ session, hub }: { session: ConflictSession; hub: Props }) {
  const isFileResolved = (f: ConflictFile) => f.resolvedCount >= f.conflictCount
  const unresolved = session.files.filter((f) => !isFileResolved(f))
  const resolved = session.files.filter(isFileResolved)
  const common = { session, onSelectFile: hub.onSelectFile }
  return (
    <>
      {unresolved.length > 0 && <Hint />}
      {unresolved.length > 0 && (
        <FileSection
          section={{ ...common, label: 'Needs your attention', files: unresolved, resolved: false }}
        />
      )}
      {resolved.length > 0 && (
        <FileSection section={{ ...common, label: 'Resolved', files: resolved, resolved: true }} />
      )}
    </>
  )
}

export function ConflictHub(props: Props) {
  const session = useMergeFlowStore((s) => s.session)
  if (!session) return null
  const allDone = session.totalConflicts - session.totalResolved === 0 && session.totalConflicts > 0
  return (
    <div className="conflict-hub">
      <HubTopBar session={session} hub={props} />
      <Hero session={session} />
      <FileSections session={session} hub={props} />
      {allDone && (
        <div className="conflict-hub__all-done">All conflicts resolved — ready to commit.</div>
      )}
    </div>
  )
}
