import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, formatRelativeTime } from '@terminator/extension-ui'
import { Lock } from 'lucide-react'
import { githubAPI } from '../../api/github'

interface Repo {
  fullName: string
  owner: string
  private: boolean
  pushedAt: string
}

interface Props {
  /** Repositories currently chosen; empty means every repository. */
  initial: string[]
  onClose: () => void
  onSaved: () => void
}

type Loaded = { repos: Repo[] } | { error: string }

interface GroupCheckboxProps {
  owner: string
  selected: number
  total: number
  onToggle: () => void
}

function GroupCheckbox(props: GroupCheckboxProps): JSX.Element {
  const { selected, total } = props
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total
  }, [selected, total])
  return (
    <label className="rp-group-label">
      <input
        aria-label={`Select every repository of ${props.owner}`}
        ref={ref}
        type="checkbox"
        checked={selected === total}
        onChange={props.onToggle}
      />
      <span className="rp-owner">{props.owner}</span>
      <span className="rp-count">
        {selected} of {total}
      </span>
    </label>
  )
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

async function fetchAccessibleRepos(refresh: boolean): Promise<Loaded> {
  try {
    return (await githubAPI.accessibleRepos(refresh)) as Loaded
  } catch (err) {
    return { error: errorText(err) }
  }
}

function reposOf(loaded: Loaded | null): Repo[] {
  if (loaded && 'repos' in loaded) return loaded.repos
  return []
}

/** The repositories matching `query`, and the same grouped by owner. */
function groupRepos(repos: Repo[], query: string) {
  const needle = query.trim().toLowerCase()
  const shown = repos.filter((r) => !needle || r.fullName.toLowerCase().includes(needle))
  const byOwner = new Map<string, Repo[]>()
  for (const r of shown) {
    const list = byOwner.get(r.owner)
    if (list) list.push(r)
    else byOwner.set(r.owner, [r])
  }
  return { shown, byOwner: [...byOwner.entries()] }
}

function toggled(prev: Set<string>, fullName: string): Set<string> {
  const next = new Set(prev)
  if (!next.delete(fullName)) next.add(fullName)
  return next
}

/** Selects the whole group, or clears it when every repository in it is already selected. */
function toggledGroup(prev: Set<string>, list: Repo[]): Set<string> {
  const next = new Set(prev)
  const all = list.every((r) => next.has(r.fullName))
  for (const r of list) {
    if (all) next.delete(r.fullName)
    else next.add(r.fullName)
  }
  return next
}

/** The accessible repositories, read once on open and again on `load`. */
function useAccessibleRepos() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const load = useCallback(async (refresh: boolean) => {
    setLoaded(null)
    setLoaded(await fetchAccessibleRepos(refresh))
  }, [])
  useEffect(() => {
    let cancelled = false
    void fetchAccessibleRepos(false).then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return { loaded, load }
}

function useRepoSelection(initial: string[], onSaved: () => void) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await githubAPI.setReviewRepos([...selected])
      onSaved()
    } catch (err) {
      setSaveError(errorText(err))
      setSaving(false)
    }
  }
  return { selected, setSelected, saving, saveError, save }
}

type Selection = ReturnType<typeof useRepoSelection>

function selectionSummary(selectedCount: number, repoCount: number): string {
  if (selectedCount === 0) return 'All repositories (nothing selected)'
  return `${selectedCount} of ${repoCount} selected`
}

function RepoRow(props: { repo: Repo; sel: Selection }) {
  const { repo: r, sel } = props
  return (
    <label className="rp-row">
      <input
        aria-label={r.fullName}
        type="checkbox"
        checked={sel.selected.has(r.fullName)}
        onChange={() => sel.setSelected((prev) => toggled(prev, r.fullName))}
      />
      <span className="rp-name">{r.fullName}</span>
      {r.private && (
        <span className="rd-chip rp-private">
          <Lock aria-hidden="true" className="tm-icon-sm" />
          private
        </span>
      )}
      <span className="rp-pushed">pushed {formatRelativeTime(r.pushedAt)}</span>
    </label>
  )
}

function OwnerGroup(props: { owner: string; list: Repo[]; sel: Selection }) {
  const { owner, list, sel } = props
  return (
    <div className="rp-group" role="group" aria-label={owner}>
      <GroupCheckbox
        owner={owner}
        selected={list.filter((r) => sel.selected.has(r.fullName)).length}
        total={list.length}
        onToggle={() => sel.setSelected((prev) => toggledGroup(prev, list))}
      />
      {list.map((r) => (
        <RepoRow key={r.fullName} repo={r} sel={sel} />
      ))}
    </div>
  )
}

interface RepoToolsProps {
  query: string
  setQuery: (q: string) => void
  shown: Repo[]
  sel: Selection
  load: (refresh: boolean) => Promise<void>
}

function RepoTools(props: RepoToolsProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const selectShown = () =>
    props.sel.setSelected((prev) => new Set([...prev, ...props.shown.map((r) => r.fullName)]))
  return (
    <div className="rp-tools">
      <input
        aria-label="Search repositories"
        ref={searchRef}
        type="search"
        className="rp-search"
        placeholder="Search repositories"
        value={props.query}
        onChange={(e) => props.setQuery(e.target.value)}
      />
      <Button size="sm" onClick={selectShown}>
        Select all shown
      </Button>
      <Button size="sm" onClick={() => props.sel.setSelected(new Set())}>
        Clear
      </Button>
      <Button size="sm" onClick={() => void props.load(true)}>
        Refresh list
      </Button>
    </div>
  )
}

interface RepoListProps {
  repos: Repo[]
  sel: Selection
  load: RepoToolsProps['load']
  /** Kept by the picker, so a refresh keeps the search. */
  search: { query: string; setQuery: (q: string) => void }
}

function RepoList(props: RepoListProps) {
  const { query, setQuery } = props.search
  const groups = useMemo(() => groupRepos(props.repos, query), [props.repos, query])
  const { sel } = props
  return (
    <>
      <RepoTools
        query={query}
        setQuery={setQuery}
        shown={groups.shown}
        sel={sel}
        load={props.load}
      />
      <div className="rp-summary" aria-live="polite">
        {selectionSummary(sel.selected.size, props.repos.length)}
      </div>
      <div className="rp-list">
        {groups.byOwner.length === 0 && <div className="rp-note">No repositories match</div>}
        {groups.byOwner.map(([owner, list]) => (
          <OwnerGroup key={owner} owner={owner} list={list} sel={sel} />
        ))}
      </div>
    </>
  )
}

function LoadError(props: { error: string; onRetry: () => void }) {
  return (
    <div className="rp-error" role="alert">
      <span>{props.error}</span>
      <Button size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  )
}

export function RepoPicker({ initial, onClose, onSaved }: Props): JSX.Element {
  const { loaded, load } = useAccessibleRepos()
  const sel = useRepoSelection(initial, onSaved)
  const repos = useMemo(() => reposOf(loaded), [loaded])
  const [query, setQuery] = useState('')
  const actions = [
    { label: 'Cancel', onSelect: onClose },
    { label: 'Save', tone: 'primary' as const, disabled: sel.saving, onSelect: sel.save },
  ]
  return (
    <Dialog title="Repositories for Reviews" size="wide" onDismiss={onClose} actions={actions}>
      <div className="rp">
        {loaded === null && <div className="rp-note">Reading your repositories…</div>}
        {loaded !== null && 'error' in loaded && (
          <LoadError error={loaded.error} onRetry={() => void load(false)} />
        )}
        {loaded !== null && 'repos' in loaded && (
          <RepoList repos={repos} sel={sel} load={load} search={{ query, setQuery }} />
        )}
        {sel.saveError && (
          <div className="rp-error" role="alert">
            {sel.saveError}
          </div>
        )}
      </div>
    </Dialog>
  )
}
