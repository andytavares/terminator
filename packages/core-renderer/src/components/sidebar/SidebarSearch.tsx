import React, { useRef } from 'react'
import { recordUse } from '../../usage/record'
import './SidebarSearch.css'

interface SidebarSearchProps {
  query: string
  onChange: (value: string) => void
  onClear: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}

/** The placeholder alone is not an accessible name, so the field carries one. */
const FIELD = {
  type: 'text',
  className: 'sidebar-search__input',
  placeholder: 'Search…',
  'aria-label': 'Search',
} as const

/** The first character of a search counts as one use; the rest of the typing does not. */
function typeInto(query: string, value: string, onChange: (value: string) => void): void {
  if (query === '') recordUse('core.sidebar.search')
  onChange(value)
}

export function SidebarSearch({
  query,
  onChange,
  onClear,
  inputRef,
}: SidebarSearchProps): React.JSX.Element {
  const internalRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? internalRef

  return (
    <div className={`sidebar-search${query ? ' sidebar-search--active' : ''}`}>
      <span className="sidebar-search__icon">⌕</span>
      <input
        ref={ref}
        {...FIELD}
        value={query}
        onChange={(e) => typeInto(query, e.target.value, onChange)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClear()
        }}
      />
      {query && (
        <button className="sidebar-search__clear" aria-label="Clear search" onClick={onClear}>
          ×
        </button>
      )}
    </div>
  )
}
