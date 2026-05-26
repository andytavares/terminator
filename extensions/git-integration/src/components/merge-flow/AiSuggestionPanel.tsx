import React, { useEffect, useState } from 'react'
import type { ConflictBlock } from '../../schemas/merge-flow.schema'
import { mergeFlowAPI } from '../../api/merge-flow'
import { highlightBlock, langFromBlockId } from '../../utils/syntax'

interface Props {
  repoRoot: string
  block: ConflictBlock
  onApply: (text: string) => void
  onClose: () => void
}

export function AiSuggestionPanel({ repoRoot, block, onApply, onClose }: Props) {
  const [suggestion, setSuggestion] = useState<{
    suggestedText: string
    explanation: string
    confidence: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    mergeFlowAPI
      .requestAiSuggestion({
        repoRoot,
        blockId: block.blockId,
        baseText: block.baseText,
        oursText: block.oursText,
        theirsText: block.theirsText,
        contextBefore: block.contextBefore,
        contextAfter: block.contextAfter,
      })
      .then((result) => {
        if ('error' in result) {
          setError(
            result.error === 'NOT_IMPLEMENTED' ? 'AI suggestions not available yet.' : result.error
          )
        } else {
          setSuggestion(result)
        }
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setIsLoading(false))
  }, [repoRoot, block.blockId])

  return (
    <div className="ai-suggestion-panel" role="complementary" aria-label="AI suggestion panel">
      <div className="ai-suggestion-panel__header">
        <h3>AI Suggestion</h3>
        <button
          className="ai-suggestion-panel__close"
          onClick={onClose}
          aria-label="Close AI panel"
        >
          ×
        </button>
      </div>
      <div className="ai-suggestion-panel__body">
        {isLoading && <div className="ai-suggestion-panel__loading">Generating suggestion…</div>}
        {error && <div className="ai-suggestion-panel__error">{error}</div>}
        {suggestion && (
          <>
            <div className="ai-suggestion-panel__explanation">{suggestion.explanation}</div>
            <div className="ai-suggestion-panel__confidence">
              Confidence: {Math.round(suggestion.confidence * 100)}%
            </div>
            <pre className="ai-suggestion-panel__code hljs">
              <code
                dangerouslySetInnerHTML={{
                  __html: highlightBlock(suggestion.suggestedText, langFromBlockId(block.blockId)),
                }}
              />
            </pre>
            <button
              className="ai-suggestion-panel__apply"
              onClick={() => onApply(suggestion.suggestedText)}
            >
              Apply suggestion
            </button>
          </>
        )}
      </div>
    </div>
  )
}
