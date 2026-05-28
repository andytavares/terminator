import React, { useEffect, useState } from 'react'
import './foundry.css'

type RunMode = 'spec-to-code' | 'co-pilot'

interface ContextFile {
  path: string
  label: string
}

interface SavedProvider {
  id: string
  type: string
  label: string
  model: string
}

interface Props {
  repoRoot: string
  onClose: () => void
  onLaunched: () => void
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

async function pickFile(filters?: Array<{ name: string; extensions: string[] }>) {
  const res = await invoke('foundry:open-file', { filters })
  if ('filePath' in res) return res.filePath as string
  return null
}

async function pickFiles(filters?: Array<{ name: string; extensions: string[] }>) {
  const res = await invoke('foundry:open-file', { filters, multiSelect: true })
  if ('filePaths' in res) return res.filePaths as string[]
  return []
}

const MD_FILTER = [{ name: 'Markdown / text', extensions: ['md', 'txt', 'mdx'] }]

export function NewRunDialog({ repoRoot, onClose, onLaunched }: Props) {
  const [mode, setMode] = useState<RunMode>('spec-to-code')
  const [specPath, setSpecPath] = useState('')
  const [specInline, setSpecInline] = useState('')
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [prompt, setPrompt] = useState('')
  const [providers, setProviders] = useState<SavedProvider[]>([])
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggingOver, setDraggingOver] = useState(false)

  useEffect(() => {
    void invoke('foundry:provider-list', { workspaceRoot: repoRoot }).then((res) => {
      const list = (res.providers as SavedProvider[]) ?? []
      setProviders(list)
      if (list.length > 0 && !providerId) {
        setProviderId(list[0].id)
        setModel(list[0].model)
      }
    })
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  const MODES: { id: RunMode; label: string; desc: string }[] = [
    {
      id: 'spec-to-code',
      label: 'Spec-to-code',
      desc: 'Generate code from a spec with approval gates',
    },
    { id: 'co-pilot', label: 'Co-pilot', desc: 'Continuous back-and-forth, no blocking gates' },
  ]

  // ── Spec file picker
  async function browseSpec() {
    const p = await pickFile(MD_FILTER)
    if (p) setSpecPath(p)
  }

  // ── Context files: add via picker
  async function browseContext() {
    const paths = await pickFiles(MD_FILTER)
    addContextPaths(paths)
  }

  function addContextPaths(paths: string[]) {
    const newFiles = paths
      .filter((p) => !contextFiles.some((c) => c.path === p))
      .map((p) => ({ path: p, label: p.split('/').pop() ?? p }))
    setContextFiles((prev) => [...prev, ...newFiles])
  }

  // ── Context files: drag-and-drop handler
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDraggingOver(false)
    const paths: string[] = []
    for (const file of e.dataTransfer.files) {
      // In Electron, File.path gives the absolute filesystem path
      const p = (file as File & { path?: string }).path
      if (p) paths.push(p)
    }
    if (paths.length) addContextPaths(paths)
  }

  // ── Launch
  async function launch() {
    setLaunching(true)
    setError(null)
    try {
      const contextContent = await Promise.all(
        contextFiles.map(async (cf) => {
          const res = await invoke('foundry:read-file', { filePath: cf.path })
          return 'content' in res ? `\n\n---\n# ${cf.label}\n\n${res.content as string}` : ''
        })
      )

      const finalPrompt =
        [specInline.trim() || undefined, ...contextContent.filter(Boolean)]
          .filter(Boolean)
          .join('\n\n') || undefined

      const res = await invoke('foundry:run-create', {
        workspaceRoot: repoRoot,
        mode,
        providerId,
        model,
        specPath: mode === 'spec-to-code' && specPath.trim() ? specPath.trim() : undefined,
        prompt: mode === 'co-pilot' ? prompt.trim() || undefined : finalPrompt,
      })
      if ('error' in res) throw new Error(res.error as string)
      onLaunched()
    } catch (err) {
      setError(String(err))
      setLaunching(false)
    }
  }

  const canLaunch =
    providerId && model && (mode === 'co-pilot' || specPath.trim() || specInline.trim())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="fnd-wizard-header">
        <span className="fnd-wizard-title">New run</span>
        <button className="fnd-wizard-close" onClick={onClose}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {/* Mode cards */}
        <div className="fnd-section-label" style={{ marginBottom: 8 }}>
          Run mode
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {MODES.map((m) => (
            <div
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`fnd-template-card${mode === m.id ? ' fnd-template-card--selected' : ''}`}
            >
              <div className="fnd-template-name">{m.label}</div>
              <div className="fnd-template-desc">{m.desc}</div>
            </div>
          ))}
        </div>

        {/* Provider + Model */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <div>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Provider
            </div>
            {providers.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--tm-warning)', padding: '4px 0' }}>
                No providers configured —{' '}
                <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={onClose}>
                  add one in Harness Settings
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProviderId(p.id)
                      setModel(p.model)
                    }}
                    className={`fnd-btn fnd-btn--sm ${providerId === p.id ? 'fnd-btn--primary' : 'fnd-btn--secondary'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Model
            </div>
            <input
              className="fnd-sensor-cmd-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. claude-sonnet-4-6"
            />
          </div>
        </div>

        {/* Spec-to-code inputs */}
        {mode === 'spec-to-code' && (
          <>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Spec file
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                className="fnd-sensor-cmd-input"
                style={{ flex: 1, fontFamily: 'var(--tm-font-mono)', fontSize: 11 }}
                value={specPath}
                onChange={(e) => setSpecPath(e.target.value)}
                placeholder="specs/001-feature/spec.md"
                readOnly
              />
              <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={browseSpec}>
                Browse…
              </button>
            </div>

            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Or inline spec / prompt
            </div>
            <textarea
              className="fnd-editor-textarea"
              style={{
                width: '100%',
                minHeight: 72,
                border: '1px solid var(--tm-border)',
                borderRadius: 'var(--tm-radius-xs)',
                background: 'var(--tm-bg-input)',
              }}
              value={specInline}
              onChange={(e) => setSpecInline(e.target.value)}
              placeholder="Describe what to build…"
            />

            {/* Context files */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 14,
                marginBottom: 6,
              }}
            >
              <div className="fnd-section-label" style={{ flex: 1, marginBottom: 0 }}>
                Additional context files
              </div>
              <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={browseContext}>
                + Add files
              </button>
            </div>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDraggingOver(true)
              }}
              onDragLeave={() => setDraggingOver(false)}
              onDrop={onDrop}
              style={{
                minHeight: 56,
                border: `1px dashed ${draggingOver ? 'var(--tm-accent)' : 'var(--tm-border-strong)'}`,
                borderRadius: 'var(--tm-radius-xs)',
                background: draggingOver ? 'var(--tm-accent-dim)' : 'var(--tm-bg-card)',
                padding: 8,
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              {contextFiles.length === 0 ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--tm-text-muted)',
                    textAlign: 'center',
                    paddingTop: 8,
                  }}
                >
                  Drag &amp; drop files here, or click "Add files"
                  <br />
                  <span style={{ fontSize: 10 }}>context.md, constitution.md, soul.md, etc.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {contextFiles.map((cf, i) => (
                    <div
                      key={cf.path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 6px',
                        background: 'var(--tm-bg-elevated)',
                        borderRadius: 'var(--tm-radius-xs)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--tm-text-secondary)',
                          fontFamily: 'var(--tm-font-mono)',
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cf.path.replace(repoRoot + '/', '')}
                      </span>
                      <button
                        onClick={() => setContextFiles((p) => p.filter((_, j) => j !== i))}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--tm-text-secondary)',
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: '0 2px',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Co-pilot input */}
        {mode === 'co-pilot' && (
          <div style={{ marginBottom: 14 }}>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Opening instruction (optional)
            </div>
            <textarea
              className="fnd-editor-textarea"
              style={{
                width: '100%',
                minHeight: 80,
                border: '1px solid var(--tm-border)',
                borderRadius: 'var(--tm-radius-xs)',
                background: 'var(--tm-bg-input)',
              }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Add error handling to the auth middleware"
            />
          </div>
        )}

        {/* AGENTS.md hint */}
        <div
          style={{
            marginTop: 14,
            padding: '8px 10px',
            border: '1px solid var(--tm-border)',
            borderRadius: 'var(--tm-radius-xs)',
            background: 'var(--tm-bg-card)',
            fontSize: 11,
            color: 'var(--tm-text-muted)',
          }}
        >
          AGENTS.md and harness sensors are included automatically.
        </div>
      </div>

      {error && <div className="fnd-error-bar">{error}</div>}

      <div className="fnd-wizard-footer">
        <span className="fnd-wizard-footer-hint" />
        <div className="fnd-wizard-footer-actions">
          <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="fnd-btn fnd-btn--primary fnd-btn--sm"
            onClick={launch}
            disabled={launching || !canLaunch}
          >
            {launching ? 'Launching…' : '▶ Launch'}
          </button>
        </div>
      </div>
    </div>
  )
}
