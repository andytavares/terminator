import { z } from 'zod'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { noPayload } from '@terminator/extension-sdk'
import { localRoute, type IpcContext } from './register'
import { insertTask, type NewTaskRow } from '../vault/task-repository'
import { orErrorString } from './vault-shared'

/** One task as written by the JSON export. */
interface ImportedTask {
  id: string
  text: string
  created_at: string
  updated_at: string
  status?: string
  project_id?: string | null
  area_id?: string | null
  project?: string | null
  area?: string | null
  context?: string | null
  due_date?: string | null
  completed_date?: string | null
  migrated_to?: string | null
  source?: string
  source_ref?: string | null
  parent_id?: string | null
  sort_order?: number
  metadata?: string
  terminator_links?: string
}

/** The JSON export's shape; rows are written as exported, unknown columns ignored. */
const ImportJsonRequestSchema = z.object({
  version: z.number().optional(),
  tasks: z
    .array(z.custom<ImportedTask>((task) => typeof task === 'object' && task !== null))
    .optional(),
  projects: z.array(z.record(z.unknown())).optional(),
  areas: z.array(z.record(z.unknown())).optional(),
})

type Row = Record<string, unknown>

/** An id reference as exported: the id itself, or (from older payloads) the row's name. */
interface ImportedRef {
  id: unknown
  name: unknown
}

/** The export writes ids; older payloads name the project or area instead. */
async function findImportedId(
  db: ExtensionDB,
  table: 'projects' | 'areas',
  ref: ImportedRef
): Promise<string | null> {
  const [column, value] = ref.id ? ['id', ref.id] : ['name', ref.name]
  if (!value) return null
  const row = await db.get<{ id: string }>(`SELECT id FROM ${table} WHERE ${column}=?`, [value])
  return row?.id ?? null
}

function exportJson({ db }: IpcContext) {
  return orErrorString(async () => {
    const tasks = await db.query(`SELECT * FROM tasks ORDER BY created_at`)
    const projects = await db.query(`SELECT * FROM projects ORDER BY name`)
    const areas = await db.query(`SELECT * FROM areas ORDER BY name`)
    return { exportedAt: new Date().toISOString(), version: 1, tasks, projects, areas }
  })
}

async function importArea(db: ExtensionDB, a: Row): Promise<void> {
  await db.run(
    `INSERT INTO areas (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [a.id, a.name, a.status ?? 'active', a.created_at, a.updated_at ?? a.created_at]
  )
}

async function importProject(db: ExtensionDB, p: Row): Promise<void> {
  const areaId = await findImportedId(db, 'areas', { id: p.area_id, name: p.area })
  await db.run(
    `INSERT INTO projects (id,name,status,area_id,deadline,outcome,terminator_links,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [
      p.id,
      p.name,
      p.status ?? 'active',
      areaId,
      p.deadline ?? null,
      p.outcome ?? null,
      p.terminator_links ?? '[]',
      p.created_at,
      p.updated_at,
    ]
  )
}

/** The insertTask fields an exported row carries as-is, defaulting what older exports omit. */
function importedTaskFields(t: ImportedTask): NewTaskRow {
  return {
    id: t.id,
    text: t.text,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    status: t.status ?? 'open',
    source: t.source ?? 'inbox',
    ...importedOptionalFields(t),
  }
}

/** The optional columns of an exported row; older exports omit some of them. */
function importedOptionalFields(t: ImportedTask): Partial<NewTaskRow> {
  return {
    context: t.context ?? null,
    dueDate: t.due_date ?? null,
    completedDate: t.completed_date ?? null,
    migratedTo: t.migrated_to ?? null,
    sourceRef: t.source_ref ?? null,
    parentId: t.parent_id ?? null,
    sortOrder: t.sort_order ?? 0,
    metadata: t.metadata ?? '{}',
    terminatorLinks: t.terminator_links ?? '[]',
  }
}

async function importTask(db: ExtensionDB, t: ImportedTask): Promise<void> {
  const projectId = await findImportedId(db, 'projects', { id: t.project_id, name: t.project })
  const areaId = await findImportedId(db, 'areas', { id: t.area_id, name: t.area })
  await insertTask(db, { ...importedTaskFields(t), projectId, areaId }, { orIgnore: true })
}

/** Imports rows one by one with `run`; returns how many it wrote. */
async function importEach<T>(
  db: ExtensionDB,
  rows: T[] | undefined,
  run: (db: ExtensionDB, row: T) => Promise<void>
): Promise<number> {
  for (const row of rows ?? []) await run(db, row)
  return rows?.length ?? 0
}

function importJson({ db }: IpcContext, data: z.infer<typeof ImportJsonRequestSchema>) {
  return orErrorString(async () => {
    let imported = await importEach(db, data.areas, importArea)
    imported += await importEach(db, data.projects, importProject)
    imported += await importEach(db, data.tasks, importTask)
    return { success: true, imported }
  })
}

/** Desktop-only channels that export the whole vault as JSON and import it back. */
export const TRANSFER_ROUTES = [
  localRoute('task-vault:vault:export-json', noPayload, exportJson),
  localRoute('task-vault:vault:import-json', ImportJsonRequestSchema, importJson),
]
