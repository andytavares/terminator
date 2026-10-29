import React, { useState, useRef, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { recordUse } from '../../usage/record'
import type { Branch } from '../../../shared/types/index'
import './dialog-fields.css'
import './BranchSelect.css'

interface Props {
  branches: Branch[]
  value: string
  onChange: (branch: string) => void
  newBranchLabel?: string
  onNewBranch?: () => void
  isNewSelected?: boolean
  onRefresh?: () => void
  refreshing?: boolean
}

export function BranchSelect(props: Props): React.JSX.Element {
  const { value, newBranchLabel, isNewSelected, onRefresh, refreshing } = props
  const { open, setOpen, containerRef } = useDropdown()

  const displayValue = isNewSelected ? (newBranchLabel ?? 'New branch…') : value || 'Select branch…'

  return (
    <div ref={containerRef} className="branch-select">
      <div className="branch-select__row">
        <button type="button" className="branch-select__trigger" onClick={() => setOpen((o) => !o)}>
          <span className="branch-select__value">{displayValue}</span>
          <span className="branch-select__caret">{open ? '▴' : '▾'}</span>
        </button>
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
      </div>
      {open && <BranchDropdown {...props} close={() => setOpen(false)} />}
    </div>
  )
}

/** Open or not; while open, a pointer press outside the container closes it. */
function useDropdown() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])
  return { open, setOpen, containerRef }
}

/** Fetches, so branches pushed since the last fetch can be chosen. */
function RefreshButton({
  onRefresh,
  refreshing,
}: Required<Pick<Props, 'onRefresh'>> & Pick<Props, 'refreshing'>): React.JSX.Element {
  return (
    <button
      type="button"
      className={`branch-select__refresh${refreshing ? ' branch-select__refresh--busy' : ''}`}
      aria-label="Fetch branches"
      title="Fetch — list branches pushed since the last fetch"
      disabled={refreshing}
      onClick={onRefresh}
    >
      <RefreshCw />
    </button>
  )
}

type DropdownProps = Props & { close: () => void }

/** The search box and the list it narrows. Mounted only while open, so the search starts empty
 * every time. */
function BranchDropdown(props: DropdownProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTimeout(() => filterRef.current?.focus(), 0)
  }, [])

  return (
    <div className="branch-select__dropdown">
      <input
        ref={filterRef}
        className="branch-select__filter"
        placeholder="Search branches…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.close()
        }}
      />
      <BranchList {...props} filter={filter} />
    </div>
  )
}

/** The branches matching the search, any "new branch" choice first. */
function BranchList({
  branches,
  filter,
  close,
  ...choice
}: DropdownProps & { filter: string }): React.JSX.Element {
  const filtered = branches.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))
  const choosing = (run: () => void) => () => {
    run()
    close()
  }
  return (
    <div className="branch-select__list">
      <NewBranchItem {...choice} choosing={choosing} />
      {filtered.map((b) => (
        <BranchItem
          key={b.name}
          branch={b}
          active={b.name === choice.value && !choice.isNewSelected}
          onClick={choosing(() => choice.onChange(b.name))}
        />
      ))}
      {filtered.length === 0 && (
        <div className="branch-select__empty">
          {filter ? 'No matching branches' : 'No branches'}
        </div>
      )}
    </div>
  )
}

interface NewBranchItemProps
  extends Pick<Props, 'newBranchLabel' | 'onNewBranch' | 'isNewSelected'> {
  /** Wraps a choice so making it also closes the dropdown. */
  choosing: (run: () => void) => () => void
}

/** The "new branch" choice above the list, when the caller offers one. */
function NewBranchItem({
  newBranchLabel,
  onNewBranch,
  isNewSelected,
  choosing,
}: NewBranchItemProps): React.JSX.Element | null {
  if (!newBranchLabel || !onNewBranch) return null
  return (
    <button
      type="button"
      className={`branch-select__item branch-select__item--new${isNewSelected ? ' branch-select__item--active' : ''}`}
      onClick={choosing(onNewBranch)}
    >
      {newBranchLabel}
    </button>
  )
}

interface BranchItemProps {
  branch: Branch
  active: boolean
  onClick: () => void
}

/** One branch, ticked when it is the checked-out one. */
function BranchItem({ branch, active, onClick }: BranchItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`branch-select__item${active ? ' branch-select__item--active' : ''}`}
      onClick={() => {
        recordUse('core.sidebar.branch-switch')
        onClick()
      }}
    >
      {branch.isCurrent && <span className="branch-select__check">✓</span>}
      <span className="branch-select__item-name">{branch.name}</span>
    </button>
  )
}
