import React, { useMemo } from 'react'
import type { RepoGroup } from '../../sidebar/branch-rows'
import { groupByTask, type TaskSection } from '../../sidebar/task-groups'
import { useTaskStore } from '../../stores/task.store'
import type { WorkThread } from '../../home/work-threads'
import { StateGlyph } from '../home/StateGlyph'
import { useWorkThreads } from '../home/useWorkThreads'
import { RepoHeader } from './RepoHeader'
import { BranchEntry, RepoGroupList, type RowContext } from './SidebarList'

interface TaskGroupListProps {
  groups: RepoGroup[]
  ctx: RowContext
}

/** Each live task with its lanes, then the branches in no task under their repos. */
export function TaskGroupList({ groups, ctx }: TaskGroupListProps): React.JSX.Element {
  const tasks = useTaskStore((s) => s.tasks)
  const { sections, rest } = useMemo(() => groupByTask(groups, tasks), [groups, tasks])
  const { allThreads } = useWorkThreads()
  return (
    <>
      {sections.map((section) => (
        <TaskSectionView
          key={section.task.id}
          section={section}
          thread={allThreads.find((t) => t.taskId === section.task.id)}
          ctx={ctx}
        />
      ))}
      {sections.length > 0 && rest.length > 0 && (
        <div className="unified-sidebar__subheading">Not in a task</div>
      )}
      <RepoGroupList groups={rest} ctx={ctx} />
    </>
  )
}

/** The header of a task, shaped as a repo's so the same header draws it. */
function headerOf(section: TaskSection, key: string): RepoGroup {
  return {
    workspaceId: key,
    label: section.task.title,
    color: '',
    folderPath: '',
    branches: section.lanes.map((lane) => lane.row),
    branchCount: section.lanes.length,
    needsYou: section.needsYou,
  }
}

interface TaskSectionViewProps {
  section: TaskSection
  /** The task's work thread, for the state its header shows. */
  thread: WorkThread | undefined
  ctx: RowContext
}

/** A task's header with its state glyph and, unless it is folded, its lanes as branch rows beneath. */
function TaskSectionView({ section, thread, ctx }: TaskSectionViewProps): React.JSX.Element {
  const { task, lanes } = section
  const key = `task:${task.id}`
  return (
    <>
      <RepoHeader
        group={headerOf(section, key)}
        collapsed={ctx.collapse.isCollapsed('task', key)}
        onToggleCollapse={() => ctx.collapse.toggle('task', key)}
        leading={thread && <StateGlyph state={thread.state} inferred={thread.inferred} />}
      />
      {!ctx.collapse.isCollapsed('task', key) &&
        lanes.map(({ repoName, row }) => (
          <BranchEntry
            key={`${task.id}:${row.projectId}`}
            row={{ ...row, label: `${repoName} · ${row.label}` }}
            workspace={ctx.data.workspaceById.get(row.workspaceId)}
            drag={{ props: undefined, over: false }}
            ctx={ctx}
          />
        ))}
    </>
  )
}
