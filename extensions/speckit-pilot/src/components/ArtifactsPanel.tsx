import React, { useCallback, useEffect, useState } from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'
import { renderMarkdown } from '../utils/markdown.js'
import type { ArtifactRef } from '../types/speckit.types.js'

interface ArtifactsPanelProps {
  featureDir: string
}

function isMarkdown(path: string | null): boolean {
  return !!path && path.endsWith('.md')
}

export function ArtifactsPanel({ featureDir }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([])
  const [selected, setSelected] = useState<ArtifactRef | null>(null)
  const [revision, setRevision] = useState<string>('current')
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await getSpeckitAPI().artifactList({ featureDir })
      if ('artifacts' in result) setArtifacts(result.artifacts)
    })()
  }, [featureDir])

  const loadContent = useCallback(
    async (ref: ArtifactRef, commit: string) => {
      if (!ref.path) return
      setContent(null)
      const result = await getSpeckitAPI().artifactRead({
        filePath: `${featureDir}/${ref.path}`,
        featureDir,
        commit: commit === 'current' ? undefined : commit,
      })
      if ('current' in result) setContent(result.current ?? '(empty)')
      else setContent(`Error: ${result.error}`)
    },
    [featureDir]
  )

  const open = useCallback(
    (ref: ArtifactRef) => {
      setSelected(ref)
      setRevision('current')
      void loadContent(ref, 'current')
    },
    [loadContent]
  )

  const onRevisionChange = useCallback(
    (commit: string) => {
      setRevision(commit)
      if (selected) void loadContent(selected, commit)
    },
    [selected, loadContent]
  )

  return (
    <div className="sk-artifacts">
      <ul className="sk-artifacts__list">
        {artifacts.map((a) => (
          <li key={a.kind}>
            <button
              type="button"
              className={`sk-artifacts__item${selected?.kind === a.kind ? ' sk-artifacts__item--on' : ''}`}
              disabled={!a.exists}
              onClick={() => open(a)}
            >
              <FileText size={14} />
              <span className="sk-artifacts__label">{a.label}</span>
              {a.revisions.length > 0 && (
                <span className="sk-artifacts__revs">{a.revisions.length} rev</span>
              )}
              {!a.exists && <span className="sk-artifacts__missing">—</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="sk-artifacts__view">
        {selected?.kind === 'pr' && selected.prUrl ? (
          <a href={selected.prUrl} target="_blank" rel="noreferrer" className="sk-btn">
            Open pull request <ExternalLink size={12} />
          </a>
        ) : selected ? (
          <>
            {selected.revisions.length > 0 && (
              <select
                aria-label="Revision"
                className="sk-artifacts__revselect"
                value={revision}
                onChange={(e) => onRevisionChange(e.target.value)}
              >
                <option value="current">Current (working copy)</option>
                {selected.revisions.map((r) => (
                  <option key={r.commit} value={r.commit}>
                    {r.commit} — {r.subject}
                  </option>
                ))}
              </select>
            )}
            {content === null ? (
              <p className="sk-artifacts__hint">Loading…</p>
            ) : isMarkdown(selected.path) ? (
              <div
                className="sk-artifacts__markdown sk-markdown"
                data-testid="artifact-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            ) : (
              <pre className="sk-artifacts__content">{content}</pre>
            )}
          </>
        ) : (
          <p className="sk-artifacts__hint">Select an artifact to view it.</p>
        )}
      </div>
    </div>
  )
}
