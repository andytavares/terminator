import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Branch, Project } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useToastStore } from '../../stores/toast.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useBranchSync } from '../../hooks/useBranchSync'
import './BranchSwitcher.css'

interface Props {
  project: Project
  workspaceFolderPath: string
  workspaceId?: string
}

function matchesGlob(pattern: string, name: string): boolean {
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*') +
      '$'
  )
  return regex.test(name)
}

function shouldExclude(patterns: string[], name: string): boolean {
  return patterns.some((p) => matchesGlob(p, name))
}

interface DropdownPos {
  top: number
  left: number
  width: number
}

export function BranchSwitcher({
  project,
  workspaceFolderPath,
  workspaceId,
}: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<DropdownPos | null>(null)
  const [localBranches, setLocalBranches] = useState<Branch[]>([])
  const [remoteBranches, setRemoteBranches] = useState<Branch[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState(false)
  const [filter, setFilter] = useState('')
  const { updateProjectBranch } = useWorkspaceStore()
  const { addToast } = useToastStore()
  const { resolveSettings } = useSettingsStore()
  const excludePatterns = resolveSettings(workspaceId).git.branchExcludePatterns ?? []
  const excludePatternsKey = excludePatterns.join('\n')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const cwd = project.worktreePath ?? workspaceFolderPath
  const currentBranch = project.gitBranch ?? '—'

  useBranchSync(project, cwd)

  function openDropdown(): void {
    if (!triggerRef.current || switching) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    setFilter('')
    setOpen(true)
    setTimeout(() => filterRef.current?.focus(), 0)
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    window.electronAPI.git
      .listBranches(cwd)
      .then((r) => {
        const allLocal = r.branches.filter((b) => !b.isRemote)
        const allRemote = r.branches.filter((b) => b.isRemote)
        const detected =
          allLocal.find((b) => b.name === 'main')?.name ??
          allLocal.find((b) => b.name === 'master')?.name ??
          null
        setDefaultBranch(detected)
        const filterFn = (b: Branch) => !shouldExclude(excludePatterns, b.name)
        const sortWithDefault = (branches: Branch[]) => {
          if (!detected) return branches
          return [...branches].sort((a, b) => {
            if (a.name === detected) return -1
            if (b.name === detected) return 1
            return 0
          })
        }
        setLocalBranches(sortWithDefault(allLocal.filter(filterFn)))
        setRemoteBranches(sortWithDefault(allRemote.filter(filterFn)))
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(`Could not load branches: ${msg}`)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cwd, excludePatternsKey])

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent): void {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function handleSelect(branch: string): Promise<void> {
    if (branch === currentBranch || switching) return
    setOpen(false)
    setSwitching(true)
    try {
      const checkoutCwd = project.isWorktree ? cwd : workspaceFolderPath
      const result = await window.electronAPI.git.checkout(checkoutCwd, branch)
      if ('error' in result) {
        addToast({ type: 'error', message: `Could not switch to "${branch}": ${result.error}` })
      } else {
        await updateProjectBranch(project.id, branch)
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: `Branch switch failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setSwitching(false)
    }
  }

  if (!project.gitBranch && !project.worktreePath) return null

  return (
    <div className="branch-sw">
      <button
        ref={triggerRef}
        className={`branch-sw__trigger${switching ? ' branch-sw__trigger--busy' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          open ? setOpen(false) : openDropdown()
        }}
        title={switching ? 'Switching branch…' : `Branch: ${currentBranch}`}
      >
        <span className="branch-sw__icon">⎇</span>
        <span className="branch-sw__name">{switching ? 'Switching…' : currentBranch}</span>
        <span className="branch-sw__caret">{open ? '▴' : '▾'}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="branch-sw__dropdown"
            style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 220) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="branch-sw__filter-wrap">
              <input
                ref={filterRef}
                className="branch-sw__filter"
                placeholder="Filter branches…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false)
                }}
              />
            </div>
            {loading && <div className="branch-sw__status">Loading branches…</div>}
            {error && <div className="branch-sw__status branch-sw__status--error">{error}</div>}
            {!loading && !error && (
              <>
                <BranchSection
                  label="Local"
                  branches={localBranches.filter((b) =>
                    b.name.toLowerCase().includes(filter.toLowerCase())
                  )}
                  current={currentBranch}
                  defaultBranch={defaultBranch}
                  onSelect={handleSelect}
                />
                {remoteBranches.length > 0 && (
                  <BranchSection
                    label="Remote"
                    branches={remoteBranches.filter((b) =>
                      b.name.toLowerCase().includes(filter.toLowerCase())
                    )}
                    current={currentBranch}
                    defaultBranch={defaultBranch}
                    onSelect={handleSelect}
                  />
                )}
                {localBranches.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))
                  .length === 0 &&
                  remoteBranches.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))
                    .length === 0 && (
                    <div className="branch-sw__status">
                      {filter ? 'No matching branches' : 'No branches found'}
                    </div>
                  )}
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

function BranchSection({
  label,
  branches,
  current,
  defaultBranch,
  onSelect,
}: {
  label: string
  branches: Branch[]
  current: string
  defaultBranch?: string | null
  onSelect: (name: string) => void
}): JSX.Element | null {
  if (branches.length === 0) return null
  return (
    <div className="branch-sw__section">
      <div className="branch-sw__section-label">{label}</div>
      {branches.map((b) => (
        <button
          key={b.name}
          className={`branch-sw__item${b.name === current ? ' branch-sw__item--active' : ''}${b.name === defaultBranch && b.name !== current ? ' branch-sw__item--default' : ''}`}
          onClick={() => onSelect(b.name)}
          title={b.name}
        >
          <span className="branch-sw__check">{b.name === current ? '✓' : ''}</span>
          <span className="branch-sw__item-name">{b.name}</span>
          {b.name === defaultBranch && <span className="branch-sw__default-badge">default</span>}
        </button>
      ))}
    </div>
  )
}
