import type { ExtensionDB } from '@terminator/extension-sdk'

const UNFINISHED_STATUSES = `'open','in-progress','in-review','blocked'`

/** Records the previous status of every project and task archiving changes, so restoring puts
 *  back exactly those. Subtasks carry no project_id or area_id: they are found via parents. */
export async function archiveAreaContents(
  db: ExtensionDB,
  areaId: string,
  now: string
): Promise<void> {
  await recordArchiveChanges(db, areaId)
  await db.run(
    `UPDATE tasks SET status='cancelled', updated_at=?
     WHERE status IN (${UNFINISHED_STATUSES}) AND id IN (
       SELECT entity_id FROM area_archive_changes WHERE area_id=? AND entity_type='task')`,
    [now, areaId]
  )
  await db.run(
    `UPDATE projects SET status='archived', updated_at=?
     WHERE id IN (
       SELECT entity_id FROM area_archive_changes WHERE area_id=? AND entity_type='project')`,
    [now, areaId]
  )
}

/** Records the current status of every project and unfinished task the archive will change. */
async function recordArchiveChanges(db: ExtensionDB, areaId: string): Promise<void> {
  await db.run(
    `INSERT INTO area_archive_changes (area_id, entity_type, entity_id, previous_status)
     SELECT ?, 'project', id, status FROM projects WHERE area_id=? AND status != 'archived'
     ON CONFLICT DO UPDATE SET previous_status=excluded.previous_status`,
    [areaId, areaId]
  )
  await db.run(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM tasks
       WHERE project_id IN (SELECT id FROM projects WHERE area_id=?)
          OR (area_id=? AND project_id IS NULL)
       UNION
       SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
     )
     INSERT INTO area_archive_changes (area_id, entity_type, entity_id, previous_status)
     SELECT ?, 'task', id, status FROM tasks
     WHERE id IN (SELECT id FROM subtree) AND status IN (${UNFINISHED_STATUSES})
     ON CONFLICT DO UPDATE SET previous_status=excluded.previous_status`,
    [areaId, areaId, areaId]
  )
}

/** Puts back what archiveAreaContents changed; entities the user changed since stay as they are. */
export async function restoreAreaContents(
  db: ExtensionDB,
  area: { id: string; archivedAt: string },
  now: string
): Promise<void> {
  const areaId = area.id
  const recorded = await db.get(`SELECT 1 FROM area_archive_changes WHERE area_id=? LIMIT 1`, [
    areaId,
  ])
  if (!recorded) return restoreUnrecordedArchive(db, area, now)
  const restoreStatus = (table: 'tasks' | 'projects', type: 'task' | 'project', current: string) =>
    db.run(
      `UPDATE ${table}
       SET status=(SELECT previous_status FROM area_archive_changes
                   WHERE area_id=? AND entity_type='${type}' AND entity_id=${table}.id),
           updated_at=?
       WHERE status='${current}' AND id IN (
         SELECT entity_id FROM area_archive_changes WHERE area_id=? AND entity_type='${type}')`,
      [areaId, now, areaId]
    )
  await restoreStatus('tasks', 'task', 'cancelled')
  await restoreStatus('projects', 'project', 'archived')
  await db.run(`DELETE FROM area_archive_changes WHERE area_id=?`, [areaId])
}

/** Areas archived before changes were recorded: match what the archive touched by its timestamp. */
async function restoreUnrecordedArchive(
  db: ExtensionDB,
  area: { id: string; archivedAt: string },
  now: string
): Promise<void> {
  await db.run(
    `UPDATE projects SET status='active', updated_at=? WHERE area_id=? AND status='archived'`,
    [now, area.id]
  )
  await db.run(
    `UPDATE tasks SET status='open', updated_at=?
     WHERE status='cancelled' AND updated_at=?
       AND (area_id=? AND project_id IS NULL
            OR project_id IN (SELECT id FROM projects WHERE area_id=?))`,
    [now, area.archivedAt, area.id, area.id]
  )
}
