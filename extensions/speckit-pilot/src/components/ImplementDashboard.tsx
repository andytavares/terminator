import React, { useEffect, useState } from 'react'

interface TaskProgress {
  id: string
  description: string
  files: string[]
  status: 'done' | 'writing' | 'queued' | 'failed' | 'skipped'
}

interface ImplementDashboardProps {
  featureDir: string
  onStop: () => Promise<void>
  onOpenTasks: () => void
}

function parseTasksFromMarkdown(content: string): TaskProgress[] {
  const tasks: TaskProgress[] = []
  const lines = content.split('\n')
  const taskRegex = /^-\s+\[([ x])\]\s+(T\d+)\s+(.*)/i

  for (const line of lines) {
    const match = taskRegex.exec(line)
    if (match) {
      const checked = match[1] === 'x' || match[1] === 'X'
      const id = match[2]
      const description = match[3].trim()
      tasks.push({
        id,
        description,
        files: [],
        status: checked ? 'done' : 'queued',
      })
    }
  }
  return tasks
}

export function ImplementDashboard({ featureDir, onStop, onOpenTasks }: ImplementDashboardProps) {
  const [tasks, setTasks] = useState<TaskProgress[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [startTime] = useState(Date.now())
  const [stopping, setStopping] = useState(false)

  // Load tasks.md
  useEffect(() => {
    const tasksPath = `${featureDir}/tasks.md`
    void window.electronAPI.fs.readFile(tasksPath).then((result) => {
      if ('content' in result) {
        const parsed = parseTasksFromMarkdown(result.content)
        setTasks(parsed)
      }
    })
  }, [featureDir])

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const progress = total > 0 ? (doneCount / total) * 100 : 0

  const writingTask = tasks.find((t) => t.status === 'writing')
  const currentTaskIdx = writingTask
    ? tasks.indexOf(writingTask)
    : tasks.findIndex((t) => t.status === 'queued')

  const handleStop = async () => {
    setStopping(true)
    try {
      await onStop()
    } finally {
      setStopping(false)
    }
  }

  // Show only first 5 tasks + collapsed rest
  const SHOW_LIMIT = 5
  const visibleTasks = tasks.slice(0, SHOW_LIMIT)
  const remainingTasks = tasks.slice(SHOW_LIMIT)

  return (
    <div className="sk-implement">
      <div className="sk-implement__header">
        <div>
          <div className="sk-implement__title">
            Implement — running
            <span className="sk-badge sk-badge--running" style={{ marginLeft: 12, fontSize: 11 }}>
              Running
            </span>
          </div>
          <div className="sk-implement__sub">
            Executing tasks from <code>tasks.md</code>. Each file write requires your approval — see
            "Per-file gate" in settings.
          </div>
        </div>
      </div>

      <div className="sk-implement__controls">
        <button
          className="sk-btn sk-btn--danger-outline"
          onClick={() => void handleStop()}
          disabled={stopping}
        >
          Stop
        </button>
        <button className="sk-btn sk-btn--ghost" onClick={onOpenTasks}>
          Open tasks.md
        </button>
        <span className="sk-implement__elapsed">{formatElapsed(elapsed)}</span>
      </div>

      {total > 0 && (
        <div className="sk-implement__progress-bar-wrap">
          <div className="sk-implement__progress-bar" style={{ width: `${progress}%` }} />
          <span className="sk-implement__progress-label">
            Task {Math.min(currentTaskIdx + 1, total)} of {total}
          </span>
        </div>
      )}

      <div className="sk-implement__task-table">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>TASK</th>
              <th>FILES</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((task) => (
              <tr key={task.id}>
                <td className="sk-implement__task-id">{task.id}</td>
                <td>{task.description}</td>
                <td className="sk-implement__task-files">
                  {task.files.length > 0 ? task.files.join(', ') : '—'}
                </td>
                <td>
                  <span className={`sk-task-badge sk-task-badge--${task.status}`}>
                    {task.status === 'done'
                      ? 'Done'
                      : task.status === 'writing'
                        ? 'Writing…'
                        : task.status === 'failed'
                          ? 'Failed'
                          : task.status === 'skipped'
                            ? 'Skipped'
                            : 'Queued'}
                  </span>
                </td>
              </tr>
            ))}
            {remainingTasks.length > 0 && (
              <tr>
                <td className="sk-implement__task-id">{`T${SHOW_LIMIT + 1}–${total}`}</td>
                <td>({remainingTasks.length} more)</td>
                <td>—</td>
                <td>
                  <span className="sk-task-badge sk-task-badge--queued">Queued</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
