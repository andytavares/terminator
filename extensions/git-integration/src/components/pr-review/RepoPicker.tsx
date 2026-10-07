import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@terminator/extension-ui'
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

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function pushedWords(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
  if (days < 1) return 'pushed today'
  if (days < 60) return `pushed ${plural(days, 'day')} ago`
  if (days < 730) return `pushed ${plural(Math.floor(days / 30), 'month')} ago`
  return `pushed ${plural(Math.floor(days / 365), 'year')} ago`
}

function GroupCheckbox({
  owner,
  selected,
  total,
  onToggle,
}: {
  owner: string
  selected: number
  total: number
  onToggle: () => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total
  }, [selected, total])
  return (
    <label className="rp-group-label">
      <input
        ref={ref}
        type="checkbox"
        checked={selected === total}
        aria-label={`Select every repository of ${owner}`}
        onChange={onToggle}
      />
      <span className="rp-owner">{owner}</span>
      <span className="rp-count">
        {selected} of {total}
      </span>
    </label>
  )
}

export function RepoPicker({ initial, onClose, onSaved }: Props): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (refresh: boolean) => {
    setLoaded(null)
    try {
      setLoaded((await githubAPI.accessibleRepos(refresh)) as Loaded)
    } catch (err) {
      setLoaded({ error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    searchRef.current?.focus()
  }, [loaded])

  const repos = useMemo(() => (loaded && 'repos' in loaded ? loaded.repos : []), [loaded])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const shown = needle ? repos.filter((r) => r.fullName.toLowerCase().includes(needle)) : repos
    const byOwner = new Map<string, Repo[]>()
    for (const r of shown) {
      const list = byOwner.get(r.owner)
      if (list) list.push(r)
      else byOwner.set(r.owner, [r])
    }
    return { shown, byOwner: [...byOwner.entries()] }
  }, [repos, query])

  const toggle = (fullName: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(fullName)) next.add(fullName)
      return next
    })

  const toggleGroup = (list: Repo[]) =>
    setSelected((prev) => {
      const next = new Set(prev)
      const all = list.every((r) => next.has(r.fullName))
      for (const r of list) {
        if (all) next.delete(r.fullName)
        else next.add(r.fullName)
      }
      return next
    })

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await githubAPI.setReviewRepos([...selected])
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const summary =
    selected.size === 0
      ? 'All repositories (nothing selected)'
      : `${selected.size} of ${repos.length} selected`

  return (
    <Dialog
      title="Repositories for Reviews"
      size="wide"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        { label: 'Save', tone: 'primary', disabled: saving, onSelect: save },
      ]}
    >
      <div className="rp">
        {loaded === null && <div className="rp-note">Reading your repositories…</div>}

        {loaded !== null && 'error' in loaded && (
          <div className="rp-error" role="alert">
            <span>{loaded.error}</span>
            <button type="button" className="rd-btn" onClick={() => void load(false)}>
              Retry
            </button>
          </div>
        )}

        {loaded !== null && 'repos' in loaded && (
          <>
            <div className="rp-tools">
              <input
                ref={searchRef}
                type="search"
                className="rp-search"
                placeholder="Search repositories"
                aria-label="Search repositories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className="rd-btn"
                onClick={() =>
                  setSelected((prev) => new Set([...prev, ...groups.shown.map((r) => r.fullName)]))
                }
              >
                Select all shown
              </button>
              <button type="button" className="rd-btn" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="rd-btn" onClick={() => void load(true)}>
                Refresh list
              </button>
            </div>
            <div className="rp-summary" aria-live="polite">
              {summary}
            </div>
            <div className="rp-list">
              {groups.byOwner.length === 0 && <div className="rp-note">No repositories match</div>}
              {groups.byOwner.map(([owner, list]) => (
                <div key={owner} className="rp-group" role="group" aria-label={owner}>
                  <GroupCheckbox
                    owner={owner}
                    selected={list.filter((r) => selected.has(r.fullName)).length}
                    total={list.length}
                    onToggle={() => toggleGroup(list)}
                  />
                  {list.map((r) => (
                    <label key={r.fullName} className="rp-row">
                      <input
                        type="checkbox"
                        checked={selected.has(r.fullName)}
                        aria-label={r.fullName}
                        onChange={() => toggle(r.fullName)}
                      />
                      <span className="rp-name">{r.fullName}</span>
                      {r.private && (
                        <span className="rd-chip rp-private">
                          <Lock aria-hidden="true" className="tm-icon-sm" />
                          private
                        </span>
                      )}
                      <span className="rp-pushed">{pushedWords(r.pushedAt)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        {saveError && (
          <div className="rp-error" role="alert">
            {saveError}
          </div>
        )}
      </div>
    </Dialog>
  )
}
