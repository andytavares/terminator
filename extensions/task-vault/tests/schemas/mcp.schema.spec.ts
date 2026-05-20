import { describe, it, expect } from 'vitest'
import {
  CaptureInputSchema,
  AddTaskInputSchema,
  CompleteTaskInputSchema,
  MigrateTaskInputSchema,
  QueryInputSchema,
  ListProjectsInputSchema,
} from '../../src/schemas/mcp.schema'

describe('mcp schemas', () => {
  describe('CaptureInputSchema', () => {
    it('accepts valid input', () => {
      expect(CaptureInputSchema.safeParse({ text: 'Do the thing' }).success).toBe(true)
    })
    it('rejects empty text', () => {
      expect(CaptureInputSchema.safeParse({ text: '' }).success).toBe(false)
    })
    it('accepts optional fields', () => {
      const r = CaptureInputSchema.safeParse({ text: 'task', hintArea: 'work', confirmed: true })
      expect(r.success).toBe(true)
    })
  })

  describe('CompleteTaskInputSchema', () => {
    it('accepts valid taskId', () => {
      expect(CompleteTaskInputSchema.safeParse({ taskId: '/vault/daily.md:5' }).success).toBe(true)
    })
    it('rejects empty taskId', () => {
      expect(CompleteTaskInputSchema.safeParse({ taskId: '' }).success).toBe(false)
    })
  })

  describe('MigrateTaskInputSchema', () => {
    it('accepts valid task + date', () => {
      const r = MigrateTaskInputSchema.safeParse({ taskId: '/x:1', targetDate: '2026-05-20' })
      expect(r.success).toBe(true)
    })
    it('rejects invalid date format', () => {
      const r = MigrateTaskInputSchema.safeParse({ taskId: '/x:1', targetDate: '20260520' })
      expect(r.success).toBe(false)
    })
  })

  describe('QueryInputSchema', () => {
    it('accepts empty query', () => {
      expect(QueryInputSchema.safeParse({}).success).toBe(true)
    })
    it('accepts status filter', () => {
      expect(QueryInputSchema.safeParse({ status: 'open' }).success).toBe(true)
    })
    it('accepts status array', () => {
      expect(QueryInputSchema.safeParse({ status: ['open', 'in-progress'] }).success).toBe(true)
    })
    it('rejects unknown status', () => {
      expect(QueryInputSchema.safeParse({ status: 'unknown' }).success).toBe(false)
    })
  })

  describe('ListProjectsInputSchema', () => {
    it('accepts empty input', () => {
      expect(ListProjectsInputSchema.safeParse({}).success).toBe(true)
    })
    it('accepts status filter', () => {
      expect(ListProjectsInputSchema.safeParse({ status: 'active' }).success).toBe(true)
    })
  })

  describe('AddTaskInputSchema', () => {
    it('accepts valid task', () => {
      const r = AddTaskInputSchema.safeParse({ filePath: '/vault/daily.md', text: 'Task text' })
      expect(r.success).toBe(true)
    })
    it('accepts with tags', () => {
      const r = AddTaskInputSchema.safeParse({
        filePath: '/vault/daily.md',
        text: 'Task',
        tags: { project: 'alpha', context: 'work' },
      })
      expect(r.success).toBe(true)
    })
    it('rejects empty filePath', () => {
      expect(AddTaskInputSchema.safeParse({ filePath: '', text: 'Task' }).success).toBe(false)
    })
  })
})
