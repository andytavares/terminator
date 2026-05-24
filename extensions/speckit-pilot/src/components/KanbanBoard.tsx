import React, { useEffect, useState } from 'react'

interface TaskProgress {
  id: string
  description: string
  status: 'done' | 'writing' | 'queued' | 'failed' | 'skipped'
}

interface Lane {
  id: string
  label: string
  statuses: TaskProgress['status'][]
}

const LANES: Lane[] = [
  { id: 'todo', label: 'Todo', statuses: ['queued'] },
  { id: 'in-progress', label: 'In Progress', statuses: ['writing'] },
  { id: 'in-review', label: 'In Review', statuses: ['failed'] },
  { id: 'done', label: 'Done', statuses: ['done', 'skipped'] },
]

const STATUS_BADGE_CLASS: Record<TaskProgress['status'], string> = {
  queued: 'sk-task-badge--queued',
  writing: 'sk-task-badge--running',
  failed: 'sk-task-badge--failed',
  done: 'sk-task-badge--done',
  skipped: 'sk-task-badge--skipped',
}

const STATUS_LABEL: Record<TaskProgress['status'], string> = {
  queued: 'Queued',
  writing: 'Writing…',
  failed: 'Failed',
  done: 'Done',
  skipped: 'Skipped',
}

function parseTasksFromMarkdown(content: string): TaskProgress[] {
  const tasks: TaskProgress[] = []
  const taskRegex = /^-\s+\[([ x])\]\s+(T\d+)\s+(.*)/i
  for (const line of content.split('\n')) {
    const match = taskRegex.exec(line)
    if (match) {
      const checked = match[1] === 'x' || match[1] === 'X'
      tasks.push({
        id: match[2],
        description: match[3].trim(),
        status: checked ? 'done' : 'queued',
      })
    }
  }
  return tasks
}

interface KanbanBoardProps {
  featureDir: string
}

export function KanbanBoard({ featureDir }: KanbanBoardProps) {
  const [tasks, setTasks] = useState<TaskProgress[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void window.electronAPI.fs.readFile(`${featureDir}/tasks.md`).then((result) => {
      setLoading(false)
      if ('content' in result) {
        setTasks(parseTasksFromMarkdown(result.content))
      }
    })
  }, [featureDir])

  if (loading) {
    return <div className="sk-loading">Loading tasks…</div>
  }

  if (tasks.length === 0) {
    return (
      <div className="sk-empty">
        <div className="sk-empty__title">No tasks found</div>
        <div className="sk-empty__sub">Run /speckit-tasks to generate tasks.md.</div>
      </div>
    )
  }

  return (
    <div className="sk-kanban">
      {LANES.map((lane) => {
        const laneTasks = tasks.filter((t) => lane.statuses.includes(t.status))
        return (
          <div key={lane.id} className="sk-kanban__lane">
            <div className="sk-kanban__lane-header">
              <span className="sk-kanban__lane-title">{lane.label}</span>
              <span className="sk-kanban__lane-count">{laneTasks.length}</span>
            </div>
            <div className="sk-kanban__lane-body">
              {laneTasks.map((task) => (
                <div key={task.id} className="sk-kanban__card">
                  <div className="sk-kanban__card-id">{task.id}</div>
                  <div className="sk-kanban__card-text">{task.description}</div>
                  <span className={`sk-task-badge ${STATUS_BADGE_CLASS[task.status]}`}>
                    {STATUS_LABEL[task.status]}
                  </span>
                </div>
              ))}
              {laneTasks.length === 0 && <div className="sk-kanban__lane-empty">—</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
