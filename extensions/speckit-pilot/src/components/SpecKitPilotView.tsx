import React, { useCallback, useEffect, useRef, useState } from 'react'
import './speckit-pilot.css'
import type { Feature, PhaseId, PhaseState, PilotState } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'
import { renderMarkdown } from '../utils/markdown.js'

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

// Primary artifact file path relative to featureDir (or repoRoot for constitution)
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

// What to run to create or advance this phase
const PHASE_COMMAND: Record<PhaseId, string> = {
  constitution: '# Create .specify/memory/constitution.md to define project principles',
  specify: '/speckit-specify',
  clarify: '/speckit-clarify',
  plan: '/speckit-plan',
  checklist: '/speckit-clarify (generates checklists)',
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
}

type PhaseStatus = PhaseState['status']

// Derive status from file existence + pilot state approvals
function deriveStatus(
  phaseId: PhaseId,
  artifactExists: boolean,
  pilotPhase?: PhaseState
): PhaseStatus {
  // Explicit states from pilot state take precedence (approval, stale, etc.)
  if (pilotPhase?.status === 'approved') return 'approved'
  if (pilotPhase?.status === 'stale') return 'stale'
  if (pilotPhase?.status === 'modified') return 'modified'
  if (pilotPhase?.status === 'failed') return 'failed'
  if (pilotPhase?.status === 'running') return 'running'
  if (pilotPhase?.status === 'awaiting_review') return 'awaiting_review'

  // Derive from file existence
  return artifactExists ? 'ready' : 'locked'
}

export function SpecKitPilotView({ repoRoot }: Props): JSX.Element {
  const api = useRef(getSpeckitAPI())

  const [features, setFeatures] = useState<Feature[]>([])
  const [selectedFeatureDir, setSelectedFeatureDir] = useState<string | null>(null)
  const [pilotState, setPilotState] = useState<PilotState | null>(null)
  const [artifactExists, setArtifactExists] = useState<Record<string, boolean>>({})
  const [selectedPhase, setSelectedPhase] = useState<PhaseId | null>(null)
  const [loadingFeatures, setLoadingFeatures] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // File viewer/editor state
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

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

  // Load pilot state + artifact existence when selected feature changes
  useEffect(() => {
    if (!selectedFeatureDir || !repoRoot) {
      setPilotState(null)
      setArtifactExists({})
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
    ])
  }, [selectedFeatureDir, repoRoot])

  // Subscribe to state-changed events
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

  // Load file content when phase changes
  useEffect(() => {
    setFileContent(null)
    setEditMode(false)
    setEditContent('')
    setSaveError(null)
    setActiveFile(null)

    if (!selectedPhase || !selectedFeatureDir || !repoRoot) return

    const { path: relPath, fromRepo } = PHASE_PRIMARY_FILE[selectedPhase]

    // Directories (like checklists/) — no file to show
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

  const handleFeatureChange = (dir: string) => {
    setSelectedFeatureDir(dir || null)
    setSelectedPhase(null)
    setFileContent(null)
  }

  const handlePhaseClick = (phaseId: PhaseId) => {
    setSelectedPhase(selectedPhase === phaseId ? null : phaseId)
  }

  const handleApprove = async () => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseApprove({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
    })
    if ('state' in result) setPilotState(result.state)
  }

  const handleRevoke = async () => {
    if (!selectedFeatureDir || !selectedPhase) return
    const result = await api.current.phaseRevoke({
      featureDir: selectedFeatureDir,
      phase: selectedPhase,
    })
    if ('state' in result) setPilotState(result.state)
  }

  const handleRefreshArtifacts = async () => {
    if (!selectedFeatureDir || !repoRoot) return
    const result = await api.current.checkArtifacts({ featureDir: selectedFeatureDir, repoRoot })
    if ('exists' in result) setArtifactExists(result.exists)
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
        // Refresh artifact status since a file was just written
        void handleRefreshArtifacts()
      } else if ('error' in result) {
        setSaveError(result.error)
      }
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleOpenInSystem = async () => {
    if (!activeFile) return
    await window.electronAPI.shell.openPath(activeFile)
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
  const selectedPhaseState = selectedPhase ? pilotState?.phases[selectedPhase] : null

  return (
    <div className="sk-view">
      {/* ── Left panel ── */}
      <div className="sk-left">
        <div className="sk-left__header">
          <span className="sk-left__title">SpecKit Pilot</span>
          <div className="sk-left__actions">
            <button
              className="sk-icon-btn"
              onClick={() => {
                void loadFeatures()
                void handleRefreshArtifacts()
              }}
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </div>

        {(features.length > 1 || features.length === 1) && (
          <div className="sk-left__feature">
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
        )}
      </div>

      {/* ── Right panel ── */}
      <div className={`sk-right${!selectedPhase ? ' sk-right--placeholder' : ''}`}>
        {!selectedPhase ? (
          <div className="sk-empty">
            <div className="sk-empty__title">Select a phase</div>
            <div className="sk-empty__sub">Click a phase to view its artifact and actions.</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="sk-right__header">
              <span className="sk-right__phase-name">{PHASE_LABELS[selectedPhase]}</span>
              {selectedStatus && (
                <span className={`sk-status-badge sk-status-badge--${selectedStatus}`}>
                  {STATUS_LABEL[selectedStatus]}
                </span>
              )}
              <div className="sk-right__header-actions">
                {activeFile && (
                  <button className="sk-btn sk-btn--secondary" onClick={handleOpenInSystem}>
                    Open in editor
                  </button>
                )}
              </div>
            </div>

            {/* Phase description */}
            <div className="sk-phase-desc">
              <p className="sk-phase-desc__text">{PHASE_DESCRIPTION[selectedPhase]}</p>
              {selectedStatus === 'locked' && (
                <div className="sk-phase-desc__locked-reason">
                  <span className="sk-phase-desc__lock-icon">🔒</span>
                  <div>
                    <div className="sk-phase-desc__lock-title">Artifact not found</div>
                    <div className="sk-phase-desc__lock-hint">
                      Run <code>{PHASE_COMMAND[selectedPhase]}</code> in a Claude Code terminal to
                      generate this artifact.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons — only show when there's something to do */}
            {selectedStatus !== 'locked' && (
              <div className="sk-actions">
                {selectedStatus !== 'approved' && (
                  <button className="sk-btn sk-btn--primary" onClick={() => void handleApprove()}>
                    Mark approved
                  </button>
                )}
                {selectedStatus === 'approved' && (
                  <button className="sk-btn sk-btn--secondary" onClick={() => void handleRevoke()}>
                    Revoke approval
                  </button>
                )}
                {selectedPhaseState?.approvedAt && (
                  <span className="sk-actions__meta">
                    Approved {new Date(selectedPhaseState.approvedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}

            {/* File viewer / editor */}
            <div className="sk-right__body">
              {loadingFile ? (
                <div className="sk-loading">Loading…</div>
              ) : (
                <FileEditor
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
      </div>
    </div>
  )
}

interface FileEditorProps {
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

function FileEditor({
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
}: FileEditorProps) {
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
          <div className="sk-md" dangerouslySetInnerHTML={{ __html: html }} />
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
