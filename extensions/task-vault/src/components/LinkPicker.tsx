import React, { useState } from 'react'
import type { IndexedTask, IndexedProject } from '../vault/types'

interface LinkPickerProps {
  targetId: string
  onLink: (item: IndexedTask | IndexedProject) => void
  onCancel: () => void
}

export function LinkPicker({ targetId, onLink, onCancel }: LinkPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<(IndexedTask | IndexedProject)[]>([])
  const [isLoading, setIsLoading] = useState(false)

  async function search(q: string) {
    setQuery(q)
    if (!q.trim()) {
      setResults([])
      return
    }
    setIsLoading(true)
    try {
      const res = await window.electronAPI.extensionBridge.invoke('task-vault:vault:query', {
        status: ['open', 'in-progress'],
      })
      const all = (res as { tasks?: IndexedTask[]; projects?: IndexedProject[] }) ?? {}
      const tasks: IndexedTask[] = all.tasks ?? []
      const projects: IndexedProject[] = all.projects ?? []
      const lower = q.toLowerCase()
      const filtered = [
        ...tasks.filter((t) => t.text.toLowerCase().includes(lower)),
        ...projects.filter((p) => p.name.toLowerCase().includes(lower)),
      ]
      setResults(filtered)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLink(item: IndexedTask | IndexedProject) {
    const isTask = 'status' in item
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      taskId: isTask ? item.id : undefined,
      projectFilePath: !isTask ? (item as IndexedProject).filePath : undefined,
      targetId,
    })
    onLink(item)
  }

  function isTask(item: IndexedTask | IndexedProject): item is IndexedTask {
    return 'status' in item
  }

  return (
    <div className="link-picker">
      <div className="link-picker__header">
        <p className="link-picker__title">Link to vault item</p>
        <button className="link-picker__close" onClick={onCancel} aria-label="Cancel">
          ×
        </button>
      </div>
      <input
        className="link-picker__search"
        type="text"
        placeholder="Search tasks or projects…"
        value={query}
        onChange={(e) => search(e.target.value)}
        autoFocus
      />
      {isLoading && <p className="link-picker__loading">Searching…</p>}
      <ul className="link-picker__results">
        {results.map((item) => (
          <li key={isTask(item) ? item.id : (item as IndexedProject).filePath}>
            <button className="link-picker__result" onClick={() => handleLink(item)}>
              <span className="link-picker__result-type">{isTask(item) ? 'Task' : 'Project'}</span>
              <span className="link-picker__result-text">
                {isTask(item) ? item.text : (item as IndexedProject).name}
              </span>
            </button>
          </li>
        ))}
        {!isLoading && query.trim() && results.length === 0 && (
          <li className="link-picker__empty">No results</li>
        )}
      </ul>
    </div>
  )
}
