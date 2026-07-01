import React, { useState } from 'react'
import { Search } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'
import type { KnowledgeRef } from '../types/speckit.types.js'

interface KnowledgeSearchProps {
  repoRoot: string
  onAttach?: (ref: KnowledgeRef) => void
}

export function KnowledgeSearch({ repoRoot, onAttach }: KnowledgeSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeRef[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    if (query.trim().length === 0) return
    setBusy(true)
    const result = await getSpeckitAPI().knowledgeSearch({ repoRoot, query: query.trim() })
    setBusy(false)
    setResults('results' in result ? result.results : [])
  }

  return (
    <div className="sk-knowledge">
      <div className="sk-knowledge__bar">
        <Search size={14} />
        <input
          aria-label="Search workspace knowledge"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="Search docs & briefs…"
        />
      </div>
      {results !== null && (
        <ul className="sk-knowledge__results">
          {results.length === 0 ? (
            <li className="sk-knowledge__empty">{busy ? 'Searching…' : 'No results'}</li>
          ) : (
            results.map((r, i) => (
              <li key={`${r.file}:${r.line}:${i}`} className="sk-knowledge__result">
                <span className="sk-knowledge__loc">
                  {r.file}:{r.line}
                </span>
                <span className="sk-knowledge__snippet">{r.snippet}</span>
                {onAttach && (
                  <button
                    type="button"
                    className="sk-btn sk-btn--small"
                    onClick={() => onAttach(r)}
                  >
                    Attach to card
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
