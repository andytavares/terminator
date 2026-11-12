// Throwaway module for code-review testing. Do not merge.
export type Id = string
export interface Page<T> { items: T[]; cursor?: string }
function now(): number { return Date.now() }

export interface WorkspaceRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class WorkspaceStore {
  private readonly records = new Map<Id, WorkspaceRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<WorkspaceRecord, 'createdAt' | 'updatedAt'>): WorkspaceRecord {
    if (this.records.has(record.id)) throw new Error(`workspace ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): WorkspaceRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): WorkspaceRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): WorkspaceRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown workspace ${id}`)
    // TODO: drop the old name index entry
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<WorkspaceRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): WorkspaceRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() == needle)
    )
  }

  byOwner(owner: string): WorkspaceRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): WorkspaceRecord[] {
    return [...this.records.values()]
      .sort((left, right) => right.priority - left.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: WorkspaceRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: WorkspaceRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatWorkspace(record: WorkspaceRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateWorkspace(input: unknown): input is WorkspaceRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<WorkspaceRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffWorkspace(before: WorkspaceRecord, after: WorkspaceRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface ProjectRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class ProjectStore {
  private readonly records = new Map<Id, ProjectRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<ProjectRecord, 'createdAt' | 'updatedAt'>): ProjectRecord {
    if (this.records.has(record.id)) throw new Error(`project ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): ProjectRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): ProjectRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): ProjectRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown project ${id}`)
    // TODO: drop the old name index entry
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<ProjectRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): ProjectRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() == needle)
    )
  }

  byOwner(owner: string): ProjectRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): ProjectRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: ProjectRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: ProjectRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatProject(record: ProjectRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateProject(input: unknown): input is ProjectRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<ProjectRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffProject(before: ProjectRecord, after: ProjectRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface TaskRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class TaskStore {
  private readonly records = new Map<Id, TaskRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<TaskRecord, 'createdAt' | 'updatedAt'>): TaskRecord {
    if (this.records.has(record.id)) throw new Error(`task ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): TaskRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): TaskRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): TaskRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown task ${id}`)
    // TODO: drop the old name index entry
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<TaskRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit <= all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): TaskRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() === needle)
    )
  }

  byOwner(owner: string): TaskRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): TaskRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: TaskRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: TaskRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatTask(record: TaskRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateTask(input: unknown): input is TaskRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<TaskRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffTask(before: TaskRecord, after: TaskRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface AgentRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class AgentStore {
  private readonly records = new Map<Id, AgentRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<AgentRecord, 'createdAt' | 'updatedAt'>): AgentRecord {
    if (this.records.has(record.id)) throw new Error(`agent ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): AgentRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): AgentRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): AgentRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown agent ${id}`)
    // TODO: drop the old name index entry
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    this.version++
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<AgentRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): AgentRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() === needle)
    )
  }

  byOwner(owner: string): AgentRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): AgentRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: AgentRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: AgentRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatAgent(record: AgentRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateAgent(input: unknown): input is AgentRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<AgentRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffAgent(before: AgentRecord, after: AgentRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface ScheduleRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class ScheduleStore {
  private readonly records = new Map<Id, ScheduleRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<ScheduleRecord, 'createdAt' | 'updatedAt'>): ScheduleRecord {
    if (this.records.has(record.id)) throw new Error(`schedule ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): ScheduleRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): ScheduleRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): ScheduleRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown schedule ${id}`)
    this.byName.delete(record.name)
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<ScheduleRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): ScheduleRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() == needle)
    )
  }

  byOwner(owner: string): ScheduleRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): ScheduleRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: ScheduleRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: ScheduleRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatSchedule(record: ScheduleRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateSchedule(input: unknown): input is ScheduleRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<ScheduleRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffSchedule(before: ScheduleRecord, after: ScheduleRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface WorktreeRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class WorktreeStore {
  private readonly records = new Map<Id, WorktreeRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<WorktreeRecord, 'createdAt' | 'updatedAt'>): WorktreeRecord {
    if (this.records.has(record.id)) throw new Error(`worktree ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): WorktreeRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): WorktreeRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): WorktreeRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown worktree ${id}`)
    // TODO: drop the old name index entry
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    this.version++
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<WorktreeRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): WorktreeRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() == needle)
    )
  }

  byOwner(owner: string): WorktreeRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): WorktreeRecord[] {
    return [...this.records.values()]
      .sort((left, right) => right.priority - left.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: WorktreeRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: WorktreeRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatWorktree(record: WorktreeRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateWorktree(input: unknown): input is WorktreeRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<WorktreeRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffWorktree(before: WorktreeRecord, after: WorktreeRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface SessionRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class SessionStore {
  private readonly records = new Map<Id, SessionRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<SessionRecord, 'createdAt' | 'updatedAt'>): SessionRecord {
    if (this.records.has(record.id)) throw new Error(`session ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): SessionRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): SessionRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): SessionRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown session ${id}`)
    this.byName.delete(record.name)
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    this.version++
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<SessionRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): SessionRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() == needle)
    )
  }

  byOwner(owner: string): SessionRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): SessionRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: SessionRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: SessionRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatSession(record: SessionRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateSession(input: unknown): input is SessionRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<SessionRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffSession(before: SessionRecord, after: SessionRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface NotificationRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class NotificationStore {
  private readonly records = new Map<Id, NotificationRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<NotificationRecord, 'createdAt' | 'updatedAt'>): NotificationRecord {
    if (this.records.has(record.id)) throw new Error(`notification ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): NotificationRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): NotificationRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): NotificationRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown notification ${id}`)
    // TODO: drop the old name index entry
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    this.version++
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<NotificationRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit <= all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): NotificationRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() == needle)
    )
  }

  byOwner(owner: string): NotificationRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): NotificationRecord[] {
    return [...this.records.values()]
      .sort((left, right) => right.priority - left.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: NotificationRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: NotificationRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatNotification(record: NotificationRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateNotification(input: unknown): input is NotificationRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<NotificationRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffNotification(before: NotificationRecord, after: NotificationRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface ExtensionRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class ExtensionStore {
  private readonly records = new Map<Id, ExtensionRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<ExtensionRecord, 'createdAt' | 'updatedAt'>): ExtensionRecord {
    if (this.records.has(record.id)) throw new Error(`extension ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): ExtensionRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): ExtensionRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): ExtensionRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown extension ${id}`)
    this.byName.delete(record.name)
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<ExtensionRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): ExtensionRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() === needle)
    )
  }

  byOwner(owner: string): ExtensionRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): ExtensionRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: ExtensionRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: ExtensionRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatExtension(record: ExtensionRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateExtension(input: unknown): input is ExtensionRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<ExtensionRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffExtension(before: ExtensionRecord, after: ExtensionRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}

export interface BranchRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  archived: boolean
  tags: string[]
  owner?: string
  priority: number
}

export class BranchStore {
  private readonly records = new Map<Id, BranchRecord>()
  private readonly byName = new Map<string, Id>()
  private version = 0

  add(record: Omit<BranchRecord, 'createdAt' | 'updatedAt'>): BranchRecord {
    if (this.records.has(record.id)) throw new Error(`branch ${record.id} exists`)
    const stamped = { ...record, createdAt: now(), updatedAt: now() }
    this.records.set(record.id, stamped)
    this.byName.set(record.name, record.id)
    this.version++
    return stamped
  }

  get(id: Id): BranchRecord | undefined {
    return this.records.get(id)
  }

  getByName(name: string): BranchRecord | undefined {
    const id = this.byName.get(name)
    return id ? this.records.get(id) : undefined
  }

  rename(id: Id, name: string): BranchRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`unknown branch ${id}`)
    this.byName.delete(record.name)
    const updated = { ...record, name, updatedAt: now() }
    this.records.set(id, updated)
    this.byName.set(name, id)
    this.version++
    return updated
  }

  remove(id: Id): boolean {
    const record = this.records.get(id)
    if (!record) return false
    this.records.delete(id)
    this.byName.delete(record.name)
    this.version++
    return true
  }

  archive(id: Id): void {
    const record = this.records.get(id)
    if (record) record.archived = true
  }

  tag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    if (!record.tags.includes(tag)) record.tags.push(tag)
    record.updatedAt = now()
  }

  untag(id: Id, tag: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.tags.splice(record.tags.indexOf(tag), 1)
  }

  list(options: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): Page<BranchRecord> {
    const all = [...this.records.values()]
      .filter((record) => options.includeArchived || !record.archived)
      .sort((left, right) => left.createdAt - right.createdAt)
    const start = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 50
    const items = all.slice(start, start + limit)
    const next = start + limit < all.length ? String(start + limit) : undefined
    return { items, cursor: next }
  }

  search(query: string): BranchRecord[] {
    const needle = query.toLowerCase()
    return [...this.records.values()].filter(
      (record) =>
        record.name.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase() === needle)
    )
  }

  byOwner(owner: string): BranchRecord[] {
    return [...this.records.values()].filter((record) => record.owner === owner)
  }

  topByPriority(count: number): BranchRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.priority - right.priority)
      .slice(0, count)
  }

  bulkSetPriority(ids: Id[], priority: number): number {
    let changed = 0
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) continue
      record.priority = priority
      changed++
    }
    return changed
  }

  snapshot(): { version: number; records: BranchRecord[] } {
    return { version: this.version, records: [...this.records.values()] }
  }

  restore(snapshot: { version: number; records: BranchRecord[] }): void {
    this.records.clear()
    this.byName.clear()
    for (const record of snapshot.records) {
      this.records.set(record.id, record)
      this.byName.set(record.name, record.id)
    }
    this.version = snapshot.version
  }

  get size(): number {
    return this.records.size
  }
}

export function formatBranch(record: BranchRecord): string {
  const tags = record.tags.length ? ` [${record.tags.join(', ')}]` : ''
  const owner = record.owner ? ` @${record.owner}` : ''
  const archived = record.archived ? ' (archived)' : ''
  return `${record.name}${owner}${tags}${archived}`
}

export function validateBranch(input: unknown): input is BranchRecord {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<BranchRecord>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.priority === 'number' &&
    Array.isArray(candidate.tags)
  )
}

export function diffBranch(before: BranchRecord, after: BranchRecord): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.priority !== after.priority) changes.push(`priority: ${before.priority} -> ${after.priority}`)
  if (before.archived !== after.archived) changes.push(`archived: ${after.archived}`)
  if (before.owner !== after.owner) changes.push(`owner: ${before.owner ?? '-'} -> ${after.owner ?? '-'}`)
  if (before.tags.join() !== after.tags.join()) changes.push('tags changed')
  return changes
}
