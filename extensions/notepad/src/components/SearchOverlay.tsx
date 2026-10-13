import './notepad.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RelativeTime, useDismissible } from '@terminator/extension-ui'
import { Search, X } from 'lucide-react'
import type { SearchResult } from '../db/types'
import { useNotesStore } from '../stores/notes.store'

interface SearchOverlayProps {
  onClose: () => void
}

/** The search's results for the current query and tag filter, and the selected row. */
type NoteSearch = ReturnType<typeof useNoteSearch>

interface TagFilterProps {
  tagCounts: [string, number][]
  activeTagFilter: string | null
  setActiveTagFilter: (tag: string | null) => void
}

interface SearchResultsProps {
  search: NoteSearch
  query: string
  openResult: (result: SearchResult) => void
}

interface SearchSurfaceProps {
  surfaceRef: React.RefObject<HTMLDivElement>
  onClose: () => void
  children: React.ReactNode
}

interface SearchResultRowProps {
  result: SearchResult
  query: string
  selected: boolean
  onHover: () => void
  onOpen: () => void
}

function highlightTitle(title: string, query: string): React.JSX.Element {
  const pattern = titleHighlightPattern(query)
  if (!pattern) return <>{title}</>
  const parts = title.split(pattern)
  return (
    <>
      {parts.map((part, i) => (
        <TitlePart key={i} part={part} highlighted={pattern.test(part)} />
      ))}
    </>
  )
}

/** Matches any query word longer than one character, or null when there is none. */
function titleHighlightPattern(query: string): RegExp | null {
  if (!query.trim()) return null
  const words = query
    .replace(/[*"]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1)
  if (words.length === 0) return null
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(${escaped.join('|')})`, 'i')
}

function TitlePart(props: { part: string; highlighted: boolean }): React.JSX.Element {
  if (props.highlighted) return <mark>{props.part}</mark>
  return <span>{props.part}</span>
}

/** Opening a result selects its note and closes the search. */
function useOpenResult(onClose: () => void) {
  const setSelected = useNotesStore((s) => s.setSelected)
  return useCallback(
    (result: SearchResult) => {
      setSelected(result.id)
      onClose()
    },
    [setSelected, onClose]
  )
}

/** useDismissible counts this palette as an open surface: without it, two Escapes with focus off
 *  the input closed Notepad instead of the search. The backdrop owns the outside click. */
export function SearchOverlay({ onClose }: SearchOverlayProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  const search = useNoteSearch(query, activeTagFilter)
  const openResult = useOpenResult(onClose)

  useDismissible({ ref: surfaceRef, onDismiss: onClose, closeOnOutsideClick: false })
  useResultKeyboard(search, openResult)

  return (
    <SearchSurface surfaceRef={surfaceRef} onClose={onClose}>
      <SearchInputRow query={query} setQuery={setQuery} search={search} />
      <TagFilters
        tagCounts={search.tagCounts}
        activeTagFilter={activeTagFilter}
        setActiveTagFilter={setActiveTagFilter}
      />
      <SearchResults search={search} query={query} openResult={openResult} />
    </SearchSurface>
  )
}

/** The backdrop, which owns the outside click, and the dialog surface on it. */
function SearchSurface({ surfaceRef, onClose, children }: SearchSurfaceProps): React.JSX.Element {
  return (
    <div
      className="notepad-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        data-tmui-surface=""
        aria-label="Search notes"
        aria-modal="true"
        ref={surfaceRef}
        className="notepad-search-overlay"
        role="dialog"
      >
        {children}
      </div>
    </div>
  )
}

function useNoteSearch(query: string, tagFilter: string | null) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isSearching, setIsSearching] = useState(false)

  const runSearch = useCallback(async (q: string, filter: string | null) => {
    setIsSearching(true)
    try {
      setResults(await queryNotes(q, filter))
      setSelectedIdx(0)
    } catch (err) {
      console.error('[notepad] search failed', err)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query, tagFilter), 200)
    return () => clearTimeout(timer)
  }, [query, tagFilter, runSearch])

  const tagCounts = useMemo(() => topTagCounts(results), [results])
  return { results, selectedIdx, setSelectedIdx, isSearching, tagCounts }
}

async function queryNotes(q: string, tagFilter: string | null): Promise<SearchResult[]> {
  const fullQuery = tagFilter ? `${q.trim()} tag:${tagFilter}`.trim() : q
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:search.query',
    { query: fullQuery, includeArchived: false }
  )
  return (result as { data?: SearchResult[] }).data ?? []
}

/** The six tags the results carry most, with how many results carry each. */
function topTagCounts(results: SearchResult[]): [string, number][] {
  const map = new Map<string, number>()
  for (const r of results) {
    for (const t of r.tags) {
      map.set(t, (map.get(t) ?? 0) + 1)
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
}

/** Arrow keys move the selection; Enter opens the selected result. */
function useResultKeyboard(search: NoteSearch, openResult: (result: SearchResult) => void) {
  const { results, selectedIdx, setSelectedIdx } = search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
  }, [results, selectedIdx, setSelectedIdx, openResult])
}

function resultCountLabel(search: NoteSearch, query: string): string {
  const count = search.results.length
  if (search.isSearching) return 'searching…'
  if (count === 0 && query) return 'no results'
  if (count === 0) return ''
  let label = count === 1 ? '1 result' : `${count} results`
  if (query.trim().length > 0) label += ' · ranked'
  return label
}

function SearchInputRow(props: {
  query: string
  setQuery: (query: string) => void
  search: NoteSearch
}): React.JSX.Element {
  const { query, setQuery, search } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const resultLabel = resultCountLabel(search, query)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="notepad-search-overlay__input-row">
      <Search className="notepad-search-overlay__icon tm-icon-lg" />
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
  )
}

function TagFilters(props: TagFilterProps): React.JSX.Element | null {
  const { tagCounts, activeTagFilter, setActiveTagFilter } = props
  if (tagCounts.length === 0) return null
  return (
    <div className="notepad-search-overlay__filters">
      <span className="notepad-search-overlay__filter-label">Filter:</span>
      {activeTagFilter && (
        <button
          className="notepad-search-overlay__filter-chip notepad-search-overlay__filter-chip--active"
          onClick={() => setActiveTagFilter(null)}
        >
          {activeTagFilter} <X className="tm-icon-sm" />
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
  )
}

function SearchResults({ search, query, openResult }: SearchResultsProps): React.JSX.Element {
  const { results, isSearching, selectedIdx, setSelectedIdx } = search
  return (
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
        <SearchResultRow
          key={r.id}
          result={r}
          query={query}
          selected={idx === selectedIdx}
          onHover={() => setSelectedIdx(idx)}
          onOpen={() => openResult(r)}
        />
      ))}
    </div>
  )
}

function SearchResultRow(props: SearchResultRowProps): React.JSX.Element {
  const { result: r, query, selected } = props
  return (
    <div
      className={`notepad-search-overlay__result${selected ? ' notepad-search-overlay__result--selected' : ''}`}
      onMouseEnter={props.onHover}
      onClick={props.onOpen}
    >
      <div className="notepad-search-overlay__result-title">{highlightTitle(r.title, query)}</div>
      <div
        className="notepad-search-overlay__result-snippet"
        dangerouslySetInnerHTML={{ __html: r.snippet }}
      />
      <div className="notepad-search-overlay__result-meta">
        <span className="notepad-search-overlay__result-tags">
          {r.tags.map((t) => `#${t}`).join(' ')}
        </span>
        <span className="notepad-search-overlay__result-time">
          <RelativeTime value={r.updatedAt} />
        </span>
      </div>
    </div>
  )
}
