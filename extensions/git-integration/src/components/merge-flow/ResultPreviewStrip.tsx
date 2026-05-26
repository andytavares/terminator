import React from 'react'
import { highlightBlock, langFromBlockId } from '../../utils/syntax'

interface Props {
  resolvedText: string | null
  blockId?: string
  isExistingResolution?: boolean
}

export function ResultPreviewStrip({ resolvedText, blockId, isExistingResolution }: Props) {
  const lang = blockId ? langFromBlockId(blockId) : undefined
  const html = resolvedText !== null ? highlightBlock(resolvedText, lang) : null

  return (
    <div className="result-preview-strip">
      <div className="result-preview-strip__label">
        {isExistingResolution ? 'Current resolution' : 'Preview'}
        {isExistingResolution && (
          <span className="result-preview-strip__resolved-badge">resolved</span>
        )}
      </div>
      {html !== null ? (
        <pre className="result-preview-strip__code hljs">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      ) : (
        <div className="result-preview-strip__placeholder">Select a resolution above</div>
      )}
    </div>
  )
}
