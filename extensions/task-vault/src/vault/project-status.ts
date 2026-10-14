import type { ExtensionDB } from '@terminator/extension-sdk'
import type { ProjectStatus } from './types'

/** Sets the status of the project named (or with id) `project`; archiving also cancels its
 *  unfinished tasks, subtasks included. False when there is no such project. */
export async function setProjectStatus(
  db: ExtensionDB,
  project: string,
  status: ProjectStatus
): Promise<boolean> {
  const now = new Date().toISOString()
  const proj =
    (await db.get<{ id: string }>(`SELECT id FROM projects WHERE name=?`, [project])) ??
    (await db.get<{ id: string }>(`SELECT id FROM projects WHERE id=?`, [project]))
  if (!proj) return false
  if (status === 'archived') {
    await db.run(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM tasks WHERE project_id=? AND parent_id IS NULL
         UNION ALL
         SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
       )
       UPDATE tasks SET status='cancelled', updated_at=?
       WHERE id IN (SELECT id FROM subtree)
         AND status IN ('open','in-progress','in-review','blocked')`,
      [proj.id, now]
    )
  }
  await db.run(`UPDATE projects SET status=?, updated_at=? WHERE id=?`, [status, now, proj.id])
  return true
}
