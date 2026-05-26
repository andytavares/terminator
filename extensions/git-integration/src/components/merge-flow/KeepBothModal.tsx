import React, { useState, useMemo } from 'react'
import type { ConflictBlock, GitAuthor } from '../../schemas/merge-flow.schema'
import { highlightBlock, langFromBlockId } from '../../utils/syntax'

interface Props {
  block: ConflictBlock
  oursAuthor?: GitAuthor
  theirsAuthor?: GitAuthor
  oursBranch?: string
  theirsBranch?: string
  onConfirm: (text: string, strategy: 'both-ours-first' | 'both-theirs-first') => void
  onCancel: () => void
}

const IDENTIFIER_RE = /\b(?:function|class|const|let|var)\s+(\w+)/g

function extractIdentifiers(text: string): Set<string> {
  const ids = new Set<string>()
  let m: RegExpExecArray | null
  IDENTIFIER_RE.lastIndex = 0
  while ((m = IDENTIFIER_RE.exec(text)) !== null) {
    ids.add(m[1])
  }
  return ids
}

function hasDuplicateIdentifiers(a: string, b: string): boolean {
  const aIds = extractIdentifiers(a)
  const bIds = extractIdentifiers(b)
  for (const id of aIds) {
    if (bIds.has(id)) return true
  }
  return false
}

const PREVIEW_LINES = 5

function CodePreview({
  code,
  lang,
  startLine = 1,
}: {
  code: string
  lang?: string
  startLine?: number
}) {
  const lines = code.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES)
  const overflow = lines.length - PREVIEW_LINES
  const html = highlightBlock(shown.join('\n'), lang)
  return (
    <div className="keep-both-modal__code-preview">
      <pre className="keep-both-modal__code-pre hljs">
        <div className="keep-both-modal__code-inner">
          <div className="keep-both-modal__line-nums" aria-hidden="true">
            {shown.map((_, i) => (
              <span key={i}>{startLine + i}</span>
            ))}
          </div>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </pre>
      {overflow > 0 && (
        <div className="keep-both-modal__overflow">
          ... ({overflow} more line{overflow !== 1 ? 's' : ''})
        </div>
      )}
    </div>
  )
}

function AuthorHeader({ author, branch }: { author?: GitAuthor; branch?: string }) {
  const hash = author?.commitHash?.slice(0, 7) ?? ''
  const ts = author?.timestamp
    ? (() => {
        try {
          const ms = Date.now() - new Date(author.timestamp).getTime()
          const min = Math.round(ms / 60000)
          if (min < 60) return `${min}m ago`
          const hr = Math.round(min / 60)
          if (hr < 24) return `${hr}h ago`
          return `${Math.round(hr / 24)}d ago`
        } catch {
          return ''
        }
      })()
    : ''

  return (
    <div className="keep-both-modal__author-row">
      <span className="keep-both-modal__drag-handle">⠿</span>
      {branch && <span className="keep-both-modal__branch-tag">{branch}</span>}
      {author?.name && <span className="keep-both-modal__author-name">{author.name}</span>}
      {hash && <span className="keep-both-modal__commit-hash">{hash}</span>}
      {ts && <span className="keep-both-modal__timestamp">{ts}</span>}
    </div>
  )
}

export function KeepBothModal({
  block,
  oursAuthor,
  theirsAuthor,
  oursBranch,
  theirsBranch,
  onConfirm,
  onCancel,
}: Props) {
  const [order, setOrder] = useState<'ours-first' | 'theirs-first'>('ours-first')
  const [dragOver, setDragOver] = useState<'first' | 'second' | null>(null)
  const lang = langFromBlockId(block.blockId)

  const oursFirst = `${block.oursText}\n${block.theirsText}`
  const theirsFirst = `${block.theirsText}\n${block.oursText}`

  const preview = order === 'ours-first' ? oursFirst : theirsFirst
  const strategy = order === 'ours-first' ? 'both-ours-first' : 'both-theirs-first'

  const previewHtml = highlightBlock(preview, lang)
  const previewLines = preview.split('\n')

  const showDuplicateWarning = useMemo(
    () => hasDuplicateIdentifiers(block.oursText, block.theirsText),
    [block.oursText, block.theirsText]
  )

  const first =
    order === 'ours-first'
      ? { id: 'ours', text: block.oursText, author: oursAuthor, branch: oursBranch, label: 'YOURS' }
      : {
          id: 'theirs',
          text: block.theirsText,
          author: theirsAuthor,
          branch: theirsBranch,
          label: 'THEIRS',
        }

  const second =
    order === 'ours-first'
      ? {
          id: 'theirs',
          text: block.theirsText,
          author: theirsAuthor,
          branch: theirsBranch,
          label: 'THEIRS',
        }
      : { id: 'ours', text: block.oursText, author: oursAuthor, branch: oursBranch, label: 'YOURS' }

  const firstName = first.author?.name
    ? `${first.author.name}'s change (${first.label})`
    : first.label

  const secondName = second.author?.name
    ? `${second.author.name}'s change (${second.label})`
    : second.label

  const handleDragStart = (e: React.DragEvent, slot: 'first' | 'second') => {
    e.dataTransfer.setData('text/plain', slot)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, slot: 'first' | 'second') => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(slot)
  }

  const handleDrop = (e: React.DragEvent, targetSlot: 'first' | 'second') => {
    e.preventDefault()
    setDragOver(null)
    const sourceSlot = e.dataTransfer.getData('text/plain') as 'first' | 'second'
    if (sourceSlot !== targetSlot) {
      setOrder((o) => (o === 'ours-first' ? 'theirs-first' : 'ours-first'))
    }
  }

  return (
    <div className="keep-both-modal" role="dialog" aria-label="Keep both changes">
      <div className="keep-both-modal__overlay" onClick={onCancel} />
      <div className="keep-both-modal__content">
        {/* Title */}
        <div className="keep-both-modal__header">
          <h3 className="keep-both-modal__title">Keep both changes — choose order</h3>
          <p className="keep-both-modal__subtitle">
            Drag blocks to reorder, or use the toggle buttons.
          </p>
        </div>

        {/* Order toggle */}
        <div className="keep-both-modal__toggle">
          <button
            className={`keep-both-modal__toggle-btn${order === 'ours-first' ? ' keep-both-modal__toggle-btn--active' : ''}`}
            aria-label="Mine first"
            onClick={() => setOrder('ours-first')}
          >
            Mine first
          </button>
          <button
            className={`keep-both-modal__toggle-btn${order === 'theirs-first' ? ' keep-both-modal__toggle-btn--active' : ''}`}
            aria-label="Theirs first"
            onClick={() => setOrder('theirs-first')}
          >
            Theirs first
          </button>
        </div>

        {/* First block */}
        <div
          className={`keep-both-modal__block-row${dragOver === 'first' ? ' keep-both-modal__block-row--drag-over' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, 'first')}
          onDragOver={(e) => handleDragOver(e, 'first')}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(e, 'first')}
        >
          <div className="keep-both-modal__block-label">
            <span className="keep-both-modal__block-num">1</span>
            <span className="keep-both-modal__block-title">{firstName}</span>
            <span className="keep-both-modal__drag-hint" title="Drag to reorder">
              ⠿ drag
            </span>
          </div>
          <div className="keep-both-modal__block-card">
            <AuthorHeader author={first.author} branch={first.branch} />
            <CodePreview code={first.text} lang={lang} startLine={1} />
          </div>
        </div>

        {/* THEN divider */}
        <div className="keep-both-modal__then">
          <span className="keep-both-modal__then-line" />
          <span className="keep-both-modal__then-label">THEN</span>
          <span className="keep-both-modal__then-line" />
        </div>

        {/* Second block */}
        <div
          className={`keep-both-modal__block-row${dragOver === 'second' ? ' keep-both-modal__block-row--drag-over' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, 'second')}
          onDragOver={(e) => handleDragOver(e, 'second')}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(e, 'second')}
        >
          <div className="keep-both-modal__block-label">
            <span className="keep-both-modal__block-num">2</span>
            <span className="keep-both-modal__block-title">{secondName}</span>
            <span className="keep-both-modal__drag-hint" title="Drag to reorder">
              ⠿ drag
            </span>
          </div>
          <div className="keep-both-modal__block-card">
            <AuthorHeader author={second.author} branch={second.branch} />
            <CodePreview code={second.text} lang={lang} startLine={1} />
          </div>
        </div>

        {/* Merged preview */}
        <div className="keep-both-modal__preview-section">
          <div className="keep-both-modal__preview-label">↓ MERGED RESULT PREVIEW</div>
          <pre className="keep-both-modal__preview hljs">
            <div className="keep-both-modal__code-inner">
              <div className="keep-both-modal__line-nums" aria-hidden="true">
                {previewLines.map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <code dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </pre>
        </div>

        {/* Duplicate warning */}
        {showDuplicateWarning && (
          <div className="keep-both-modal__warning" role="alert">
            ⚠ Warning: This will produce a duplicate identifier. Consider using &quot;Edit
            manually&quot; to combine them.
          </div>
        )}

        {/* Actions */}
        <div className="keep-both-modal__actions">
          <button className="keep-both-modal__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="keep-both-modal__confirm" onClick={() => onConfirm(preview, strategy)}>
            Use this order →
          </button>
        </div>
      </div>
    </div>
  )
}
