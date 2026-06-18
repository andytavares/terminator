import './notepad.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { SearchResult } from '../db/types'
import { useNotesStore } from '../stores/notes.store'

function highlightTitle(title: string, query: string): React.JSX.Element {
  if (!query.trim()) return <>{title}</>
  const words = query
    .replace(/[*"]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1)
  if (words.length === 0) return <>{title}</>
  const pattern = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi'
  )
  const parts = title.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
      )}
    </>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface SearchOverlayProps {
  onClose: () => void
}

export function SearchOverlay({ onClose }: SearchOverlayProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setSelected } = useNotesStore()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = useCallback(async (q: string, tagFilter: string | null) => {
    const fullQuery = tagFilter ? `${q.trim()} tag:${tagFilter}`.trim() : q
    setIsSearching(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:search.query',
        { query: fullQuery, includeArchived: false }
      )
      const data = (result as { data?: SearchResult[] }).data ?? []
      setResults(data)
      setSelectedIdx(0)
    } catch (err) {
      console.error('[notepad] search failed', err)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch(query, activeTagFilter)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, activeTagFilter, runSearch])

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of results) {
      for (const t of r.tags) {
        map.set(t, (map.get(t) ?? 0) + 1)
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  }, [results])

  function openResult(result: SearchResult) {
    setSelected(result.id)
    onClose()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      }
      if (e.key === 'Enter' && results[selectedIdx]) {
        e.preventDefault()
        openResult(results[selectedIdx])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [results, selectedIdx, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRanked = query.trim().length > 0
  const resultLabel = isSearching
    ? 'searching…'
    : results.length > 0
      ? `${results.length} result${results.length === 1 ? '' : 's'}${isRanked ? ' · ranked' : ''}`
      : query
        ? 'no results'
        : ''

  return (
    <div
      className="notepad-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="notepad-search-overlay"
        role="dialog"
        aria-label="Search notes"
        aria-modal="true"
      >
        <div className="notepad-search-overlay__input-row">
          <Search size={15} className="notepad-search-overlay__icon" />
          <input
            ref={inputRef}
            className="notepad-search-overlay__input"
            placeholder="Search across all notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {resultLabel && <span className="notepad-search-overlay__count">{resultLabel}</span>}
        </div>
        {tagCounts.length > 0 && (
          <div className="notepad-search-overlay__filters">
            <span className="notepad-search-overlay__filter-label">Filter:</span>
            {activeTagFilter && (
              <button
                className="notepad-search-overlay__filter-chip notepad-search-overlay__filter-chip--active"
                onClick={() => setActiveTagFilter(null)}
              >
                {activeTagFilter} <X size={9} />
              </button>
            )}
            {tagCounts
              .filter(([tag]) => tag !== activeTagFilter)
              .map(([tag, count]) => (
                <button
                  key={tag}
                  className="notepad-search-overlay__filter-chip"
                  onClick={() => setActiveTagFilter(tag)}
                >
                  # {tag} {count}
                </button>
              ))}
          </div>
        )}
        <div className="notepad-search-overlay__results">
          {results.length === 0 && !isSearching && query && (
            <div className="notepad-search-overlay__empty">
              No notes found for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.length === 0 && !query && (
            <div className="notepad-search-overlay__empty">
              Type to search. Use <code>tag:name</code> to filter by tag.
            </div>
          )}
          {results.map((r, idx) => (
            <div
              key={r.id}
              className={`notepad-search-overlay__result${idx === selectedIdx ? ' notepad-search-overlay__result--selected' : ''}`}
              onMouseEnter={() => setSelectedIdx(idx)}
              onClick={() => openResult(r)}
            >
              <div className="notepad-search-overlay__result-title">
                {highlightTitle(r.title, query)}
              </div>
              <div
                className="notepad-search-overlay__result-snippet"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
              <div className="notepad-search-overlay__result-meta">
                <span className="notepad-search-overlay__result-tags">
                  {r.tags.map((t) => `#${t}`).join(' ')}
                </span>
                <span className="notepad-search-overlay__result-time">
                  {relativeTime(r.updatedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
