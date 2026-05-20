import React, { useEffect, useState } from 'react'
import type { IndexedTask, IndexedProject } from '../vault/types'

interface LinkedVaultPanelProps {
  targetId: string
}

interface LinkResult {
  tasks: IndexedTask[]
  projects: IndexedProject[]
}

export function LinkedVaultPanel({ targetId }: LinkedVaultPanelProps): React.JSX.Element {
  const [links, setLinks] = useState<LinkResult>({ tasks: [], projects: [] })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    load()
  }, [targetId])

  async function load() {
    setIsLoading(true)
    try {
      const res = await window.electronAPI.extensionBridge.invoke(
        'task-vault:links:get-for-terminator-target',
        { targetId }
      )
      const data = res as LinkResult
      setLinks(data ?? { tasks: [], projects: [] })
    } finally {
      setIsLoading(false)
    }
  }

  async function removeLink(item: IndexedTask | IndexedProject) {
    const isTask = 'status' in item
    await window.electronAPI.extensionBridge.invoke('task-vault:links:remove', {
      taskId: isTask ? item.id : undefined,
      projectFilePath: !isTask ? (item as IndexedProject).filePath : undefined,
      targetId,
    })
    await load()
  }

  const isEmpty = links.tasks.length === 0 && links.projects.length === 0

  if (isLoading) {
    return <div className="linked-vault-panel linked-vault-panel--loading">Loading links…</div>
  }

  return (
    <div className="linked-vault-panel">
      <p className="linked-vault-panel__title">Linked vault items</p>

      {isEmpty && (
        <p className="linked-vault-panel__empty">No vault items linked to this terminal session.</p>
      )}

      {links.tasks.length > 0 && (
        <section className="linked-vault-panel__section">
          <p className="linked-vault-panel__section-title">Tasks</p>
          <ul className="linked-vault-panel__list">
            {links.tasks.map((task) => (
              <li key={task.id} className="linked-vault-panel__item">
                <span
                  className={`linked-vault-panel__status linked-vault-panel__status--${task.status}`}
                />
                <span className="linked-vault-panel__text">{task.text}</span>
                <button
                  className="linked-vault-panel__remove"
                  onClick={() => removeLink(task)}
                  aria-label="Remove link"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {links.projects.length > 0 && (
        <section className="linked-vault-panel__section">
          <p className="linked-vault-panel__section-title">Projects</p>
          <ul className="linked-vault-panel__list">
            {links.projects.map((project) => (
              <li key={project.filePath} className="linked-vault-panel__item">
                <span className="linked-vault-panel__text">{project.name}</span>
                <button
                  className="linked-vault-panel__remove"
                  onClick={() => removeLink(project)}
                  aria-label="Remove link"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
