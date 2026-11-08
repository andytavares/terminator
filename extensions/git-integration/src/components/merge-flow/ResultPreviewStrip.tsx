import React from 'react'
import { extensionOfBlock, highlight } from '../../utils/syntax'

interface Props {
  resolvedText: string | null
  blockId?: string
  isExistingResolution?: boolean
}

export function ResultPreviewStrip({ resolvedText, blockId, isExistingResolution }: Props) {
  const lang = blockId ? extensionOfBlock(blockId) : undefined
  const html = resolvedText !== null ? highlight(resolvedText, lang) : null

  const label = isExistingResolution ? 'Current resolution' : 'Preview'
  return (
    <div className="result-preview-strip" role="group" aria-label={label}>
      <div className="result-preview-strip__label">
        {label}
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
