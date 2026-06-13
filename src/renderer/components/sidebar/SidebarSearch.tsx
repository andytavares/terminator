import React, { useRef } from 'react'
import './SidebarSearch.css'

interface SidebarSearchProps {
  query: string
  onChange: (value: string) => void
  onClear: () => void
  inputRef?: React.RefObject<HTMLInputElement>
}

export function SidebarSearch({
  query,
  onChange,
  onClear,
  inputRef,
}: SidebarSearchProps): JSX.Element {
  const internalRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? internalRef

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') onClear()
  }

  return (
    <div className={`sidebar-search${query ? ' sidebar-search--active' : ''}`}>
      <span className="sidebar-search__icon">⌕</span>
      <input
        ref={ref}
        type="text"
        className="sidebar-search__input"
        value={query}
        placeholder="Search…"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {query && (
        <button className="sidebar-search__clear" aria-label="Clear search" onClick={onClear}>
          ×
        </button>
      )}
    </div>
  )
}
