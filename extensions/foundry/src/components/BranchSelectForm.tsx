import React, { useEffect, useState } from 'react'

interface Props {
  repoRoot: string
  onSubmit: (result: { baseBranch: string; featureBranch: string }) => void
  onCancel: () => void
}

interface BranchInfo {
  name: string
  current: boolean
}

const BRANCH_RE = /^[a-zA-Z0-9/_-]+$/

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

export function BranchSelectForm({ repoRoot, onSubmit, onCancel }: Props) {
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [baseBranch, setBaseBranch] = useState('')
  const [featureBranch, setFeatureBranch] = useState('')
  const [featureError, setFeatureError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    void (async () => {
      const result = await invoke('foundry:branch-list', { workspaceRoot: repoRoot })
      if ('error' in result) {
        setLoading(false)
        return
      }
      const list = (result.branches as BranchInfo[]) ?? []
      setBranches(list)
      const current = list.find((b) => b.current)
      if (current) setBaseBranch(current.name)
      setLoading(false)
    })()
  }, [repoRoot])

  function validateFeatureBranch(value: string): string {
    if (!value.trim()) return 'Feature branch name is required'
    if (!BRANCH_RE.test(value)) return 'Only letters, numbers, /, _, - are allowed'
    if (branches.some((b) => b.name === value))
      return `Branch "${value}" already exists — choose a different name`
    return ''
  }

  function handleFeatureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setFeatureBranch(v)
    setFeatureError(v ? validateFeatureBranch(v) : '')
    setSubmitError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validateFeatureBranch(featureBranch)
    if (err) {
      setFeatureError(err)
      return
    }
    if (!baseBranch) return

    setSubmitting(true)
    setSubmitError('')

    try {
      onSubmit({ baseBranch, featureBranch })
    } catch (err) {
      setSubmitError(String(err))
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="fnd-panel">
        <div className="fnd-header">
          <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={onCancel}>
            ← Back
          </button>
          <span className="fnd-title">New Run</span>
        </div>
        <div className="fnd-empty">Loading branches…</div>
      </div>
    )
  }

  const isValid = baseBranch && featureBranch && !featureError

  return (
    <div className="fnd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="fnd-header">
        <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={onCancel}>
          ← Back
        </button>
        <span className="fnd-title">New Run — Branch Setup</span>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="base-branch"
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-secondary)' }}
          >
            Base branch
          </label>
          <select
            id="base-branch"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            style={{
              background: 'var(--tm-bg-input)',
              color: 'var(--tm-text)',
              border: '1px solid var(--tm-border)',
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 13,
            }}
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.current ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>
            The worktree will be created from this branch.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="feature-branch"
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-secondary)' }}
          >
            Feature branch name
          </label>
          <input
            id="feature-branch"
            type="text"
            value={featureBranch}
            onChange={handleFeatureChange}
            placeholder="e.g. fix/auth-timeout or feat/new-dashboard"
            autoFocus
            style={{
              background: 'var(--tm-bg-input)',
              color: 'var(--tm-text)',
              border: `1px solid ${featureError ? 'var(--tm-danger)' : 'var(--tm-border)'}`,
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 13,
              outline: 'none',
            }}
          />
          {featureError && (
            <span style={{ fontSize: 11, color: 'var(--tm-danger)' }}>{featureError}</span>
          )}
          {!featureError && (
            <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>
              A worktree will be created at{' '}
              <code style={{ fontFamily: 'monospace' }}>
                .worktrees/{featureBranch ? featureBranch.replace(/\//g, '-') : '…'}
              </code>
            </span>
          )}
        </div>

        {submitError && (
          <div
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 4,
              padding: '8px 10px',
              fontSize: 12,
              color: 'var(--tm-danger)',
            }}
          >
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="fnd-btn fnd-btn--secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="fnd-btn fnd-btn--primary"
            disabled={!isValid || submitting}
          >
            {submitting ? 'Creating worktree…' : 'Continue →'}
          </button>
        </div>
      </form>
    </div>
  )
}
