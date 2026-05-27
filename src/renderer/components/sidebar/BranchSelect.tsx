import React, { useState, useRef, useEffect } from 'react'
import type { Branch } from '../../../shared/types/index'
import './BranchSelect.css'

interface Props {
  branches: Branch[]
  value: string
  onChange: (branch: string) => void
  newBranchLabel?: string
  onNewBranch?: () => void
  isNewSelected?: boolean
}

export function BranchSelect({
  branches,
  value,
  onChange,
  newBranchLabel,
  onNewBranch,
  isNewSelected,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const filtered = branches.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))

  useEffect(() => {
    if (!open) {
      setFilter('')
      return
    }
    setTimeout(() => filterRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const displayValue = isNewSelected ? (newBranchLabel ?? 'New branch…') : value || 'Select branch…'

  return (
    <div ref={containerRef} className="branch-select">
      <button type="button" className="branch-select__trigger" onClick={() => setOpen((o) => !o)}>
        <span className="branch-select__value">{displayValue}</span>
        <span className="branch-select__caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="branch-select__dropdown">
          <input
            ref={filterRef}
            className="branch-select__filter"
            placeholder="Search branches…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <div className="branch-select__list">
            {newBranchLabel && onNewBranch && (
              <button
                type="button"
                className={`branch-select__item branch-select__item--new${isNewSelected ? ' branch-select__item--active' : ''}`}
                onClick={() => {
                  onNewBranch()
                  setOpen(false)
                }}
              >
                {newBranchLabel}
              </button>
            )}
            {filtered.map((b) => (
              <button
                key={b.name}
                type="button"
                className={`branch-select__item${b.name === value && !isNewSelected ? ' branch-select__item--active' : ''}`}
                onClick={() => {
                  onChange(b.name)
                  setOpen(false)
                }}
              >
                {b.isCurrent && <span className="branch-select__check">✓</span>}
                <span className="branch-select__item-name">{b.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="branch-select__empty">
                {filter ? 'No matching branches' : 'No branches'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
