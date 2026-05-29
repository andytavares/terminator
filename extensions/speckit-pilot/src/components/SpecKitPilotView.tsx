import React, { useCallback, useEffect, useRef, useState } from 'react'
import './speckit-pilot.css'
import type {
  Feature,
  HistoryEntry,
  PhaseId,
  PhaseState,
  PilotSettings,
  PilotState,
} from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'
import { renderMarkdown } from '../utils/markdown.js'
import { ApprovalPanel } from './ApprovalPanel.js'
import { ArtifactDiff } from './ArtifactDiff.js'
import { ImplementDashboard } from './ImplementDashboard.js'
import { SettingsPage } from './SettingsPage.js'
import { KanbanBoard } from './KanbanBoard.js'

interface Props {
  repoRoot: string | null
}

const PHASE_LABELS: Record<PhaseId, string> = {
  constitution: 'Constitution',
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklists',
  tasks: 'Tasks',
  analyze: 'Analyze',
  implement: 'Implement',
}

const PHASE_PRIMARY_FILE: Record<PhaseId, { path: string; fromRepo?: boolean }> = {
  constitution: { path: '.specify/memory/constitution.md', fromRepo: true },
  specify: { path: 'spec.md' },
  clarify: { path: 'spec.md' },
  plan: { path: 'plan.md' },
  checklist: { path: 'checklists' },
  tasks: { path: 'tasks.md' },
  analyze: { path: 'tasks.md' },
  implement: { path: 'tasks.md' },
}

const PHASE_COMMAND: Record<PhaseId, string> = {
  constitution: '/speckit-constitution',
  specify: '/speckit-specify',
  clarify: '/speckit-clarify',
  plan: '/speckit-plan',
  checklist: '/speckit-checklist',
  tasks: '/speckit-tasks',
  analyze: '/speckit-analyze',
  implement: '/speckit-implement',
}

const PHASE_DESCRIPTION: Record<PhaseId, string> = {
  constitution: 'Defines the non-negotiable principles for this project.',
  specify: 'Captures what users need and why — the feature specification.',
  clarify: 'Resolves ambiguities in the spec before planning begins.',
  plan: 'Technical architecture, data model, and implementation contracts.',
  checklist: 'Quality gates that must pass before the feature can ship.',
  tasks: 'Ordered implementation task list derived from the plan.',
  analyze: 'Cross-checks spec, plan, and tasks for gaps and inconsistencies.',
  implement: 'Executes the task list, one phase at a time with human review.',
}

const STATUS_ICON: Record<string, string> = {
  approved: '✓',
  awaiting_review: '◎',
  running: '◌',
  ready: '○',
  locked: '—',
  stale: '△',
  modified: '△',
  failed: '✗',
  skipped: '⊘',
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Approved',
  awaiting_review: 'Review',
  running: 'Running',
  ready: 'Ready',
  locked: 'Not started',
  stale: 'Stale',
  modified: 'Modified',
  failed: 'Failed',
  skipped: 'Skipped',
}

type PhaseStatus = PhaseState['status']
type RightPanelView = 'detail' | 'diff' | 'settings'

interface ActiveSession {
  id: string
  name: string
}

function deriveStatus(
  phaseId: PhaseId,
  artifactExists: boolean,
  pilotPhase?: PhaseState
): PhaseStatus {
  // A phase with no artifact file is treated as skipped regardless of stored status,
  // except for statuses that don't require an artifact (running, failed, locked, ready).
  if (!artifactExists) {
    if (pilotPhase?.status === 'running') return 'running'
    if (pilotPhase?.status === 'failed') return 'failed'
    if (pilotPhase?.status === 'skipped') return 'skipped'
    if (pilotPhase?.status === 'approved' || pilotPhase?.status === 'stale') return 'skipped'
    return pilotPhase?.status === 'awaiting_review' ? 'awaiting_review' : 'locked'
  }
  if (pilotPhase?.status === 'skipped') return 'skipped'
  if (pilotPhase?.status === 'approved') return 'approved'
  if (pilotPhase?.status === 'stale') return 'stale'
  if (pilotPhase?.status === 'modified') return 'modified'
  if (pilotPhase?.status === 'failed') return 'failed'
  if (pilotPhase?.status === 'running') return 'running'
  if (pilotPhase?.status === 'awaiting_review') return 'awaiting_review'
  return 'ready'
}

export function SpecKitPilotView({ repoRoot }: Props): JSX.Element {
  const api = useRef(getSpeckitAPI())

  const [kanbanMode, setKanbanMode] = useState<boolean>(
    () => localStorage.getItem('speckit-pilot.kanbanMode') === 'true'
  )
  const [features, setFeatures] = useState<Feature[]>([])
  const [selectedFeatureDir, setSelectedFeatureDir] = useState<string | null>(null)
  const [pilotState, setPilotState] = useState<PilotState | null>(null)
  const [artifactExists, setArtifactExists] = useState<Record<string, boolean>>({})
  const [selectedPhase, setSelectedPhase] = useState<PhaseId | null>(null)
  const [loadingFeatures, setLoadingFeatures] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // History / activity
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // Right panel view: 'detail' | 'diff' | 'settings'
  const [rightView, setRightView] = useState<RightPanelView>('detail')

  // Diff state
  const [diffContent, setDiffContent] = useState<{
    current: string | null
    approved: string | null
  } | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  // File viewer/editor state (for 'detail' when approved)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

  // Run-in-terminal dialog
  const [showRunDialog, setShowRunDialog] = useState(false)
  const [runSessions, setRunSessions] = useState<ActiveSession[]>([])
  const [runSessionId, setRunSessionId] = useState('')

  const toggleKanban = () => {
    setKanbanMode((prev) => {
      const next = !prev
      localStorage.setItem('speckit-pilot.kanbanMode', String(next))
      return next
    })
  }

  const loadFeatures = useCallback(async () => {
    if (!repoRoot) return
    setLoadingFeatures(true)
    setError(null)
    try {
      const result = await api.current.featureList({ repoRoot })
      if ('features' in result) {
        setFeatures(result.features)
        if (result.features.length === 1 && !selectedFeatureDir) {
          setSelectedFeatureDir(result.features[0].dir)
        }
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoadingFeatures(false)
    }
  }, [repoRoot, selectedFeatureDir])

  // Load pilot state + artifacts + history when feature changes
  useEffect(() => {
    if (!selectedFeatureDir || !repoRoot) {
      setPilotState(null)
      setArtifactExists({})
      setHistory([])
      return
    }

    void Promise.all([
      api.current.pilotState({ featureDir: selectedFeatureDir }).then((r) => {
        if ('state' in r) setPilotState(r.state)
        else setPilotState(null)
      }),
      api.current.checkArtifacts({ featureDir: selectedFeatureDir, repoRoot }).then((r) => {
        if ('exists' in r) setArtifactExists(r.exists)
      }),
      api.current.historyLoad({ featureDir: selectedFeatureDir }).then((r) => {
        if ('entries' in r) setHistory(r.entries)
      }),
    ])
  }, [selectedFeatureDir, repoRoot])

  // Subscribe to state-changed push events
  useEffect(() => {
    const unsub = api.current.onStateChanged((data) => {
      const payload = data as { state: PilotState }
      if (payload?.state) setPilotState(payload.state)
    })
    return unsub
  }, [])

  useEffect(() => {
    void loadFeatures()
  }, [loadFeatures])

  // Load file content when phase changes (for detail view)
  useEffect(() => {
    setFileContent(null)
    setEditMode(false)
    setEditContent('')
    setSaveError(null)
    setActiveFile(null)
    setDiffContent(null)
    setRightView('detail')

    if (!selectedPhase || !selectedFeatureDir || !repoRoot) return

    const { path: relPath, fromRepo } = PHASE_PRIMARY_FILE[selectedPhase]
    if (relPath.endsWith('/') || relPath === 'checklists') return

    const filePath = fromRepo ? `${repoRoot}/${relPath}` : `${selectedFeatureDir}/${relPath}`
    setActiveFile(filePath)
    setLoadingFile(true)

    void window.electronAPI.fs.readFile(filePath).then((result) => {
      setLoadingFile(false)
      if ('content' in result) {
        setFileContent(result.content)
        setEditContent(result.content)
      } else {
        setFileContent(null)
      }
    })
  }, [selectedPhase, selectedFeatureDir, repoRoot])

  const loadDiff = useCallback(async () => {
    if (!activeFile || !selectedFeatureDir) return
    setLoadingDiff(true)
    try {
      const result = await api.current.artifactRead({
        filePath: activeFile,
        featureDir: selectedFeatureDir,
        repoRoot: repoRoot ?? undefined,
      })
      if ('current' in result) setDiffContent(result)
    } finally {
      setLoadingDiff(false)
    }
  }, [activeFile, selectedFeatureDir, repoRoot])

  const handleOpenDiff = async () => {
    setRightView('diff')
    if (!diffContent) await loadDiff()
  }

  const handleFeatureChange = (dir: string) => {
    setSelectedFeatureDir(dir || null)
    setSelectedPhase(null)
    setFileContent(null)
    setRightView('detail')
  }

  const handlePhaseClick = (phaseId: PhaseId) => {
    if (selectedPhase === phaseId) {
      setSelectedPhase(null)
    } else {
      setSelectedPhase(phaseId)
      setRightView('detail')
    }
  }

  const refreshHistory = async () => {
    if (!selectedFeatureDir) return
    const r = await api.current.historyLoad({ featureDir: selectedFeatureDir })
    if ('entries' in r) setHistory(r.entries)
  }

  const refreshArtifacts = async () => {
    if (!selectedFeatureDir || !repoRoot) return
    const result = await api.current.checkArtifacts({ featureDir: selectedFeatureDir, repoRoot })
    if ('exists' in result) setArtifactExists(result.exists)
  }

  const handleApprove = async (note?: string) => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseApprove({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
      note,
    })
    if ('state' in result) {
      setPilotState(result.state)
      await refreshHistory()
    }
  }

  const handleReject = async (reason: string) => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseReject({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
      reason,
    })
    if ('state' in result) {
      setPilotState(result.state)
      await refreshHistory()
      await refreshArtifacts()
    }
  }

  const handleRevoke = async (note?: string) => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseRevoke({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
      note,
    })
    if ('state' in result) {
      setPilotState(result.state)
      await refreshHistory()
    }
  }

  const handleSkip = async () => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseSkip({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
    })
    if ('state' in result) {
      setPilotState(result.state)
      await refreshHistory()
    }
  }

  const handleUnskip = async () => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseUnskip({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
    })
    if ('state' in result) {
      setPilotState(result.state)
      await refreshHistory()
    }
  }

  const handleSave = async () => {
    if (!activeFile) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await api.current.fileWrite({ filePath: activeFile, content: editContent })
      if ('ok' in result) {
        setFileContent(editContent)
        setEditMode(false)
        await refreshArtifacts()
      } else if ('error' in result) {
        setSaveError(result.error)
      }
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndApprove = async (content: string) => {
    if (!activeFile || !selectedFeatureDir || !selectedPhase) return
    const writeResult = await api.current.fileWrite({ filePath: activeFile, content })
    if ('error' in writeResult) return
    setFileContent(content)
    setEditContent(content)
    // Refresh diff
    const diffResult = await api.current.artifactRead({
      filePath: activeFile,
      featureDir: selectedFeatureDir,
      repoRoot: repoRoot ?? undefined,
    })
    if ('current' in diffResult) setDiffContent(diffResult)
    await refreshHistory()
    await refreshArtifacts()
  }

  const handleOpenInSystem = async () => {
    if (!activeFile) return
    await window.electronAPI.shell.openPath(activeFile)
  }

  const handleImplementStop = async () => {
    if (!selectedFeatureDir) return
    await api.current.implementStop({ featureDir: selectedFeatureDir, phase: 'implement' })
  }

  const handleSaveSettings = async (newSettings: PilotSettings) => {
    if (!selectedFeatureDir || !pilotState) return
    const newState = { ...pilotState, settings: newSettings }
    await api.current.fileWrite({
      filePath: `${selectedFeatureDir}/.pilot/state.json`,
      content: JSON.stringify(newState, null, 2),
    })
    setPilotState(newState)
    setRightView('detail')
  }

  const handleOpenRunDialog = async () => {
    const result = await api.current.sessionList()
    setRunSessions('sessions' in result ? result.sessions : [])
    setRunSessionId('')
    setShowRunDialog(true)
  }

  const handleSendToSession = () => {
    if (!selectedPhase || !runSessionId) return
    window.electronAPI.terminal.input(runSessionId, PHASE_COMMAND[selectedPhase] + '\r')
    setShowRunDialog(false)
  }

  const handleCopyCommand = () => {
    if (!selectedPhase) return
    void navigator.clipboard.writeText(PHASE_COMMAND[selectedPhase])
  }

  if (!repoRoot) {
    return (
      <div className="sk-view sk-view--empty">
        <div className="sk-empty">
          <div className="sk-empty__title">No workspace open</div>
          <div className="sk-empty__sub">Open a repository to use SpecKit Pilot.</div>
        </div>
      </div>
    )
  }

  const getStatus = (phaseId: PhaseId): PhaseStatus =>
    deriveStatus(phaseId, artifactExists[phaseId] ?? false, pilotState?.phases[phaseId])

  const selectedStatus = selectedPhase ? getStatus(selectedPhase) : null
  const selectedPhaseState = selectedPhase ? pilotState?.phases[selectedPhase] : undefined

  // Phase history entries (for the approval panel activity feed)
  const phaseHistory = selectedPhase ? history.filter((e) => e.phase === selectedPhase) : history

  return (
    <div className="sk-view">
      {/* ── Left panel ── */}
      <div className="sk-left">
        <div className="sk-left__header">
          <span className="sk-left__title">SpecKit Pilot</span>
          <div className="sk-left__actions">
            {selectedFeatureDir && (
              <button
                className={`sk-icon-btn${kanbanMode ? ' sk-icon-btn--active' : ''}`}
                title={kanbanMode ? 'Switch to list view' : 'Switch to kanban view'}
                onClick={toggleKanban}
              >
                ⊞
              </button>
            )}
            <button
              className="sk-icon-btn"
              title="Settings"
              onClick={() => setRightView(rightView === 'settings' ? 'detail' : 'settings')}
            >
              ⚙
            </button>
            <button
              className="sk-icon-btn"
              onClick={() => {
                void loadFeatures()
                void refreshArtifacts()
              }}
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </div>

        {features.length > 0 && (
          <div className="sk-left__feature">
            <div className="sk-feature-label">FEATURE</div>
            <select
              className="sk-feature-select"
              value={selectedFeatureDir ?? ''}
              onChange={(e) => handleFeatureChange(e.target.value)}
            >
              {features.length > 1 && <option value="">Select a feature…</option>}
              {features.map((f) => (
                <option key={f.dir} value={f.dir}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {loadingFeatures && <div className="sk-loading">Loading…</div>}

        {!loadingFeatures && features.length === 0 && (
          <div className="sk-empty">
            <div className="sk-empty__title">No features found</div>
            <div className="sk-empty__sub">
              Run <code>/speckit-specify</code> in a Claude Code terminal to create a feature spec.
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: '8px 12px', color: 'var(--tm-danger)', fontSize: 11 }}>
            {error}
          </div>
        )}

        {features.length > 0 && selectedFeatureDir && (
          <>
            <div className="sk-phase-list">
              {PHASE_ORDER.map((phaseId) => {
                const status = getStatus(phaseId)
                const { path: relPath } = PHASE_PRIMARY_FILE[phaseId]
                const displayPath = relPath === 'checklists' ? 'checklists/' : relPath
                return (
                  <div
                    key={phaseId}
                    className={`sk-phase-row sk-phase-row--${status}${selectedPhase === phaseId ? ' sk-phase-row--selected' : ''}`}
                    onClick={() => handlePhaseClick(phaseId)}
                  >
                    <div className={`sk-phase-icon sk-phase-icon--${status}`}>
                      {STATUS_ICON[status] ?? '○'}
                    </div>
                    <div className="sk-phase-row__body">
                      <div className="sk-phase-row__name">{PHASE_LABELS[phaseId]}</div>
                      <div className="sk-phase-row__file">{displayPath}</div>
                    </div>
                    <div className={`sk-phase-row__status sk-phase-row__status--${status}`}>
                      {STATUS_LABEL[status]}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Status bar at bottom */}
            {selectedPhase && selectedStatus && (
              <div className="sk-left__statusbar">
                <span
                  className={`sk-phase-icon sk-phase-icon--${selectedStatus}`}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    display: 'inline-block',
                    marginRight: 6,
                  }}
                />
                <span>
                  {PHASE_LABELS[selectedPhase]} {STATUS_LABEL[selectedStatus]}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right panel ── */}
      <div
        className={`sk-right${!selectedPhase && rightView !== 'settings' ? ' sk-right--placeholder' : ''}`}
      >
        {/* Settings page */}
        {rightView === 'settings' && pilotState && (
          <SettingsPage
            settings={pilotState.settings}
            onSave={handleSaveSettings}
            onDismiss={() => setRightView('detail')}
          />
        )}

        {rightView === 'settings' && !pilotState && (
          <div className="sk-empty">
            <div className="sk-empty__sub">Select a feature to configure settings.</div>
          </div>
        )}

        {kanbanMode && selectedFeatureDir && rightView !== 'settings' && (
          <div className="sk-right__body sk-right__body--scrollable">
            <KanbanBoard featureDir={selectedFeatureDir} />
          </div>
        )}

        {!kanbanMode && rightView !== 'settings' && !selectedPhase && (
          <div className="sk-empty">
            <div className="sk-empty__title">Select a phase</div>
            <div className="sk-empty__sub">Click a phase to view its artifact and actions.</div>
          </div>
        )}

        {!kanbanMode && rightView !== 'settings' && selectedPhase && selectedStatus && (
          <>
            {/* Tab bar */}
            <div className="sk-right__tabs">
              <div className="sk-right__tab-group">
                <div className={`sk-tab${rightView === 'detail' ? ' sk-tab--active' : ''}`}>
                  <span className="sk-tab__label" onClick={() => setRightView('detail')}>
                    {selectedFeatureDir?.split('/').pop()} · {PHASE_LABELS[selectedPhase]}
                  </span>
                  <button
                    className="sk-tab__close"
                    aria-label="Close tab"
                    onClick={() => {
                      setSelectedPhase(null)
                      setRightView('detail')
                    }}
                  >
                    ×
                  </button>
                </div>
                {diffContent !== null && (
                  <div className={`sk-tab${rightView === 'diff' ? ' sk-tab--active' : ''}`}>
                    <span className="sk-tab__label" onClick={() => setRightView('diff')}>
                      {PHASE_PRIMARY_FILE[selectedPhase].path} (diff)
                    </span>
                    <button
                      className="sk-tab__close"
                      aria-label="Close diff tab"
                      onClick={() => {
                        setDiffContent(null)
                        setRightView('detail')
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Diff view */}
            {rightView === 'diff' && (
              <div className="sk-right__body sk-right__body--scrollable">
                {loadingDiff ? (
                  <div className="sk-loading">Loading diff…</div>
                ) : diffContent ? (
                  <ArtifactDiff
                    filePath={activeFile ?? ''}
                    currentContent={diffContent.current}
                    approvedContent={diffContent.approved}
                    onSaveAndApprove={handleSaveAndApprove}
                    onOpenInEditor={handleOpenInSystem}
                  />
                ) : (
                  <div className="sk-empty">
                    <div className="sk-empty__sub">No diff available.</div>
                  </div>
                )}
              </div>
            )}

            {/* Detail view */}
            {rightView === 'detail' && (
              <>
                {/* Implement running — show dashboard */}
                {selectedStatus === 'running' &&
                  selectedPhase === 'implement' &&
                  selectedFeatureDir && (
                    <div className="sk-right__body sk-right__body--scrollable">
                      <ImplementDashboard
                        featureDir={selectedFeatureDir}
                        onStop={handleImplementStop}
                        onOpenTasks={handleOpenInSystem}
                      />
                    </div>
                  )}

                {/* Non-implement running */}
                {selectedStatus === 'running' && selectedPhase !== 'implement' && (
                  <div className="sk-right__body">
                    <div className="sk-approval__card">
                      <div className="sk-approval__card-header">
                        <div className="sk-approval__card-title">
                          {PHASE_LABELS[selectedPhase]} — running
                        </div>
                        <span className="sk-badge sk-badge--running">Running</span>
                      </div>
                      <div className="sk-approval__card-sub">
                        Watching for <code>{PHASE_PRIMARY_FILE[selectedPhase].path}</code> to be
                        written…
                      </div>
                    </div>
                  </div>
                )}

                {/* Awaiting review or modified or approved — show approval panel + file preview */}
                {(selectedStatus === 'awaiting_review' ||
                  selectedStatus === 'approved' ||
                  selectedStatus === 'modified') &&
                  selectedPhaseState && (
                    <div className="sk-right__body sk-right__body--scrollable">
                      <ApprovalPanel
                        phase={selectedPhase}
                        phaseState={selectedPhaseState}
                        phaseLabel={PHASE_LABELS[selectedPhase]}
                        phaseCommand={PHASE_COMMAND[selectedPhase]}
                        recentHistory={phaseHistory}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onRevoke={handleRevoke}
                        onOpenDiff={() => void handleOpenDiff()}
                      />
                      {fileContent !== null && activeFile && (
                        <div className="sk-artifact-preview">
                          <div className="sk-artifact-preview__header">
                            <span className="sk-artifact-preview__filename">
                              {PHASE_PRIMARY_FILE[selectedPhase].path}
                            </span>
                            <button
                              className="sk-btn sk-btn--ghost sk-btn--xs"
                              onClick={handleOpenInSystem}
                            >
                              Open in editor
                            </button>
                          </div>
                          <div
                            className="sk-md sk-artifact-preview__body"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(fileContent) }}
                            onClick={(e) => {
                              const anchor = (e.target as HTMLElement).closest('a')
                              if (anchor?.href) {
                                e.preventDefault()
                                e.stopPropagation()
                                window.electronAPI.shell.openExternal(anchor.href).catch(() => {})
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                {/* Ready / locked / failed / stale / skipped — show info + file preview */}
                {(selectedStatus === 'ready' ||
                  selectedStatus === 'locked' ||
                  selectedStatus === 'failed' ||
                  selectedStatus === 'stale' ||
                  selectedStatus === 'skipped') && (
                  <>
                    <div className="sk-right__header">
                      <span className="sk-right__phase-name">{PHASE_LABELS[selectedPhase]}</span>
                      <span className={`sk-status-badge sk-status-badge--${selectedStatus}`}>
                        {STATUS_LABEL[selectedStatus]}
                      </span>
                      <div className="sk-right__header-actions">
                        {activeFile && (
                          <button className="sk-btn sk-btn--secondary" onClick={handleOpenInSystem}>
                            Open in editor
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="sk-phase-desc">
                      <p className="sk-phase-desc__text">{PHASE_DESCRIPTION[selectedPhase]}</p>
                      {selectedStatus === 'locked' && (
                        <div className="sk-phase-desc__locked-reason">
                          <span className="sk-phase-desc__lock-icon">🔒</span>
                          <div>
                            <div className="sk-phase-desc__lock-title">Upstream not approved</div>
                            <div className="sk-phase-desc__lock-hint">
                              Approve upstream phases first, then run{' '}
                              <code>{PHASE_COMMAND[selectedPhase]}</code>.
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedStatus === 'stale' && (
                        <div className="sk-phase-desc__locked-reason">
                          <span>⚠</span>
                          <div>
                            <div className="sk-phase-desc__lock-title">Upstream changed</div>
                            <div className="sk-phase-desc__lock-hint">
                              An upstream artifact was modified. Re-run{' '}
                              <code>{PHASE_COMMAND[selectedPhase]}</code> to regenerate.
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedStatus === 'ready' && (
                        <div className="sk-phase-desc__locked-reason">
                          <div>
                            <div className="sk-phase-desc__lock-hint">
                              Run <code>{PHASE_COMMAND[selectedPhase]}</code> in a Claude Code
                              terminal to generate this artifact.
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedStatus === 'skipped' && (
                        <div className="sk-phase-desc__locked-reason">
                          <span>⊘</span>
                          <div>
                            <div className="sk-phase-desc__lock-title">Never run</div>
                            <div className="sk-phase-desc__lock-hint">
                              No artifact found. Run <code>{PHASE_COMMAND[selectedPhase]}</code> to
                              produce output.
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="sk-phase-desc__run-actions">
                        {(selectedStatus === 'ready' || selectedStatus === 'stale') &&
                          fileContent !== null && (
                            <button
                              className="sk-btn sk-btn--primary sk-btn--xs"
                              onClick={() => void handleApprove()}
                              title="Approve the existing artifact without re-running"
                            >
                              Approve
                            </button>
                          )}
                        {selectedStatus !== 'skipped' && (
                          <button
                            className="sk-btn sk-btn--secondary sk-btn--xs"
                            onClick={() => void handleOpenRunDialog()}
                            title={`Run ${PHASE_COMMAND[selectedPhase]} in an active terminal session`}
                          >
                            ▶ Run in terminal
                          </button>
                        )}
                        {selectedStatus !== 'skipped' ? (
                          <button
                            className="sk-btn sk-btn--ghost sk-btn--xs"
                            onClick={() => void handleSkip()}
                            title="Mark this phase as skipped — useful for smaller features that don't need every step"
                          >
                            Skip phase
                          </button>
                        ) : (
                          <button
                            className="sk-btn sk-btn--secondary sk-btn--xs"
                            onClick={() => void handleUnskip()}
                            title="Restore this phase to ready so it can be run"
                          >
                            Unskip phase
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="sk-right__body">
                      {loadingFile ? (
                        <div className="sk-loading">Loading…</div>
                      ) : (
                        <FileViewer
                          filePath={activeFile}
                          content={fileContent}
                          editMode={editMode}
                          editContent={editContent}
                          saving={saving}
                          saveError={saveError}
                          isDirectory={PHASE_PRIMARY_FILE[selectedPhase].path === 'checklists'}
                          onEditModeChange={setEditMode}
                          onContentChange={setEditContent}
                          onSave={() => void handleSave()}
                        />
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Run-in-terminal dialog */}
      {showRunDialog && selectedPhase && (
        <div className="sk-modal-overlay" onClick={() => setShowRunDialog(false)}>
          <div className="sk-modal sk-run-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sk-modal__header">
              <span className="sk-modal__title">Run in terminal</span>
              <button className="sk-modal__close" onClick={() => setShowRunDialog(false)}>
                ✕
              </button>
            </div>
            <div className="sk-run-dialog__body">
              <p className="sk-run-dialog__command">
                Command: <code>{PHASE_COMMAND[selectedPhase]}</code>
              </p>
              {runSessions.length > 0 ? (
                <>
                  <div className="sk-run-dialog__label">Send to session:</div>
                  <select
                    className="sk-feature-select"
                    value={runSessionId}
                    onChange={(e) => setRunSessionId(e.target.value)}
                  >
                    <option value="">Choose a session…</option>
                    {runSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="sk-run-dialog__actions">
                    <button
                      className="sk-btn sk-btn--primary"
                      onClick={handleSendToSession}
                      disabled={!runSessionId}
                    >
                      Send command
                    </button>
                    <button
                      className="sk-btn sk-btn--ghost"
                      onClick={() => setShowRunDialog(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="sk-run-dialog__hint">
                    No active terminal sessions found. Open a Claude Code terminal first, then run:
                  </p>
                  <div className="sk-run-dialog__copy-row">
                    <code className="sk-run-dialog__copy-cmd">{PHASE_COMMAND[selectedPhase]}</code>
                    <button className="sk-btn sk-btn--ghost sk-btn--xs" onClick={handleCopyCommand}>
                      Copy
                    </button>
                  </div>
                  <div className="sk-run-dialog__actions">
                    <button
                      className="sk-btn sk-btn--ghost"
                      onClick={() => setShowRunDialog(false)}
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface FileViewerProps {
  filePath: string | null
  content: string | null
  editMode: boolean
  editContent: string
  saving: boolean
  saveError: string | null
  isDirectory?: boolean
  onEditModeChange(mode: boolean): void
  onContentChange(v: string): void
  onSave(): void
}

function FileViewer({
  filePath,
  content,
  editMode,
  editContent,
  saving,
  saveError,
  isDirectory,
  onEditModeChange,
  onContentChange,
  onSave,
}: FileViewerProps) {
  if (isDirectory) {
    return (
      <div className="sk-empty">
        <div className="sk-empty__sub">
          Checklist files are stored in <code>checklists/</code>. Open the folder to view individual
          checklists.
        </div>
      </div>
    )
  }

  if (!filePath) {
    return (
      <div className="sk-empty">
        <div className="sk-empty__sub">No artifact file for this phase.</div>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="sk-empty">
        <div className="sk-empty__title">File not found</div>
        <div className="sk-empty__sub">This artifact hasn't been created yet.</div>
      </div>
    )
  }

  const html = renderMarkdown(content)
  const hasChanges = editContent !== content
  const shortPath = filePath.split('/').slice(-2).join('/')

  return (
    <div className="sk-editor">
      <div className="sk-editor__toolbar">
        <span className="sk-editor__filename">{shortPath}</span>
        <div className="sk-editor__mode-toggle">
          <button
            className={`sk-editor__mode-btn${!editMode ? ' sk-editor__mode-btn--active' : ''}`}
            onClick={() => onEditModeChange(false)}
          >
            Preview
          </button>
          <button
            className={`sk-editor__mode-btn${editMode ? ' sk-editor__mode-btn--active' : ''}`}
            onClick={() => onEditModeChange(true)}
          >
            Edit
          </button>
        </div>
      </div>

      <div className="sk-editor__content">
        {editMode ? (
          <textarea
            className="sk-editor__textarea"
            value={editContent}
            onChange={(e) => onContentChange(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div
            className="sk-md"
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={(e) => {
              const anchor = (e.target as HTMLElement).closest('a')
              if (anchor?.href) {
                e.preventDefault()
                e.stopPropagation()
                window.electronAPI.shell.openExternal(anchor.href).catch(() => {})
              }
            }}
          />
        )}
      </div>

      {editMode && (
        <div className="sk-editor__save-bar">
          {saveError && (
            <span style={{ color: 'var(--tm-danger)', fontSize: 11 }}>{saveError}</span>
          )}
          <span className="sk-editor__save-hint">
            {hasChanges ? 'Unsaved changes' : 'No changes'}
          </span>
          <button
            className="sk-btn sk-btn--primary"
            onClick={onSave}
            disabled={!hasChanges || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            className="sk-btn sk-btn--secondary"
            onClick={() => {
              onContentChange(content)
              onEditModeChange(false)
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
