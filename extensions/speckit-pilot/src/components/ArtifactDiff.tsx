import React, { useMemo, useState } from 'react'

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  oldLine: number | null
  newLine: number | null
  content: string
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  // Simple line-by-line diff using LCS
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  // Build hunks using a simple diff algorithm
  const result: DiffLine[] = []

  // Use a simple Myers diff approach via patience diff
  const lcs = longestCommonSubsequence(oldLines, newLines)

  let oi = 0
  let ni = 0
  let lcsIdx = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (lcsIdx < lcs.length && oi === lcs[lcsIdx][0] && ni === lcs[lcsIdx][1]) {
      result.push({ type: 'context', oldLine: oi + 1, newLine: ni + 1, content: oldLines[oi] })
      oi++
      ni++
      lcsIdx++
    } else if (oi < oldLines.length && (lcsIdx >= lcs.length || oi < lcs[lcsIdx][0])) {
      result.push({ type: 'remove', oldLine: oi + 1, newLine: null, content: oldLines[oi] })
      oi++
    } else {
      result.push({ type: 'add', oldLine: null, newLine: ni + 1, content: newLines[ni] })
      ni++
    }
  }

  return result
}

function longestCommonSubsequence(a: string[], b: string[]): [number, number][] {
  const m = a.length
  const n = b.length
  // For large files, limit to avoid O(mn) blowup
  if (m * n > 100000) {
    return []
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Traceback
  const result: [number, number][] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return result.reverse()
}

interface ArtifactDiffProps {
  filePath: string
  currentContent: string | null
  approvedContent: string | null
  onSaveAndApprove?: (content: string) => Promise<void>
  onOpenInEditor?: () => void
}

export function ArtifactDiff({
  filePath,
  currentContent,
  approvedContent,
  onSaveAndApprove,
  onOpenInEditor,
}: ArtifactDiffProps) {
  const [hideUnchanged, setHideUnchanged] = useState(false)
  const [editContent] = useState(currentContent ?? '')
  const [saving, setSaving] = useState(false)

  const shortPath = filePath.split('/').slice(-3).join('/')

  const diffLines = useMemo(() => {
    if (!approvedContent && !currentContent) return []
    if (!approvedContent) {
      // All lines are new
      return (currentContent ?? '')
        .split('\n')
        .map((line, i): DiffLine => ({ type: 'add', oldLine: null, newLine: i + 1, content: line }))
    }
    if (!currentContent) {
      // All lines removed
      return (approvedContent ?? '')
        .split('\n')
        .map(
          (line, i): DiffLine => ({ type: 'remove', oldLine: i + 1, newLine: null, content: line })
        )
    }
    return computeDiff(approvedContent, currentContent)
  }, [approvedContent, currentContent])

  const hasChanges = diffLines.some((l) => l.type !== 'context')
  const addCount = diffLines.filter((l) => l.type === 'add').length
  const removeCount = diffLines.filter((l) => l.type === 'remove').length

  const visibleLines = hideUnchanged
    ? diffLines.filter((l, i, arr) => {
        if (l.type !== 'context') return true
        // Show context lines near changes
        const near = arr.slice(Math.max(0, i - 3), i + 4)
        return near.some((n) => n.type !== 'context')
      })
    : diffLines

  const handleSave = async () => {
    if (!onSaveAndApprove) return
    setSaving(true)
    try {
      await onSaveAndApprove(editContent)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sk-diff">
      <div className="sk-diff__header">
        <div className="sk-diff__path">
          <code>{shortPath}</code>
          {approvedContent !== null && (
            <span className="sk-diff__comparing">
              comparing <span className="sk-diff__ver">last approved</span>
              {' ↔ '}
              <span className="sk-diff__ver">working copy</span>
            </span>
          )}
        </div>
        <div className="sk-diff__controls">
          {hasChanges && (
            <span className="sk-diff__stats">
              <span className="sk-diff__add">+{addCount}</span>{' '}
              <span className="sk-diff__remove">−{removeCount}</span>
            </span>
          )}
          <label className="sk-checkbox-label sk-diff__toggle">
            <input
              type="checkbox"
              checked={hideUnchanged}
              onChange={(e) => setHideUnchanged(e.target.checked)}
            />
            Hide unchanged
          </label>
          {onOpenInEditor && (
            <button className="sk-btn sk-btn--ghost sk-btn--xs" onClick={onOpenInEditor}>
              Open in editor
            </button>
          )}
          {onSaveAndApprove && hasChanges && (
            <button
              className="sk-btn sk-btn--primary sk-btn--xs"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save & mark ready for re-approval'}
            </button>
          )}
        </div>
      </div>

      {!hasChanges && (
        <div className="sk-diff__no-changes">
          No changes — working copy matches last approved version.
        </div>
      )}
      {hasChanges && (
        <div className="sk-diff__body">
          <table className="sk-diff__table">
            <tbody>
              {visibleLines.map((line, i) => {
                if (line.type === 'header') {
                  return (
                    <tr key={i} className="sk-diff__row sk-diff__row--header">
                      <td className="sk-diff__ln sk-diff__ln--old" />
                      <td className="sk-diff__ln sk-diff__ln--new" />
                      <td className="sk-diff__prefix" />
                      <td className="sk-diff__content">{line.content}</td>
                    </tr>
                  )
                }
                return (
                  <tr key={i} className={`sk-diff__row sk-diff__row--${line.type}`}>
                    <td className="sk-diff__ln sk-diff__ln--old">{line.oldLine ?? ''}</td>
                    <td className="sk-diff__ln sk-diff__ln--new">{line.newLine ?? ''}</td>
                    <td className="sk-diff__prefix">
                      {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                    </td>
                    <td className="sk-diff__content">
                      <code>{line.content}</code>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasChanges && onSaveAndApprove && (
        <div className="sk-diff__info">
          <div className="sk-diff__info-title">What happens when I save</div>
          <ol className="sk-diff__info-list">
            <li>
              Working copy of <code>{shortPath.split('/').pop()}</code> is written to disk.
            </li>
            <li>
              Phase status flips to <strong>Modified — re-approval required</strong>.
            </li>
            <li>
              Downstream phases auto-mark <strong>Stale</strong>; you choose what to rerun.
            </li>
            <li>
              An entry is appended to <code>.pilot/history.jsonl</code> with the diff hash and your
              username.
            </li>
          </ol>
        </div>
      )}
    </div>
  )
}
