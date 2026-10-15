export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface BatchItem39 {
  id: string
  index: number
  priority: Priority
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>
}

export interface BatchResult39 {
  items: BatchItem39[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface BatchFilter39 {
  priority?: Priority
  tags?: string[]
  fromDate?: Date
  toDate?: Date
  search?: string
}
