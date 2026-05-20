#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { captureTask } from './tools/capture.js'
import { getTodayLog } from './tools/today.js'
import { addTaskMcp } from './tools/add-task.js'
import { completeTaskMcp } from './tools/complete-task.js'
import { migrateTaskMcp } from './tools/migrate-task.js'
import { queryTasks } from './tools/query.js'
import { listProjectsMcp } from './tools/list-projects.js'
import { weeklyReviewMcp } from './tools/weekly-review.js'
import {
  CaptureInputSchema,
  AddTaskInputSchema,
  CompleteTaskInputSchema,
  MigrateTaskInputSchema,
  QueryInputSchema,
  ListProjectsInputSchema,
} from '../schemas/mcp.schema.js'

const VAULT_PATH = process.env.TASK_VAULT_PATH ?? ''

if (!VAULT_PATH) {
  process.stderr.write('Error: TASK_VAULT_PATH environment variable is required\n')
  process.exit(1)
}

const server = new Server({ name: 'task-vault', version: '0.1.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'capture',
      description: 'Append a new task to inbox.md',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Task text (non-empty)' },
          hintArea: { type: 'string' },
          hintProject: { type: 'string' },
          confirmed: { type: 'boolean', description: 'Bypass auto-execute gate' },
        },
        required: ['text'],
      },
    },
    {
      name: 'today',
      description: "Get today's daily log",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'add_task',
      description: 'Add a task to a specific vault file',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          text: { type: 'string' },
          section: { type: 'string' },
          due: { type: 'string' },
          tags: { type: 'object' },
          confirmed: { type: 'boolean' },
        },
        required: ['filePath', 'text'],
      },
    },
    {
      name: 'complete_task',
      description: "Mark a task [x] with today's date",
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'migrate_task',
      description: 'Migrate a task [>] to a target date',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          targetDate: { type: 'string', description: 'YYYY-MM-DD' },
          confirmed: { type: 'boolean' },
        },
        required: ['taskId', 'targetDate'],
      },
    },
    {
      name: 'query',
      description: 'Query tasks across all vault files',
      inputSchema: {
        type: 'object',
        properties: {
          status: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          context: { type: 'string' },
          project: { type: 'string' },
          area: { type: 'string' },
          dueBefore: { type: 'string' },
          filePattern: { type: 'string' },
        },
      },
    },
    {
      name: 'list_projects',
      description: 'List projects by status',
      inputSchema: {
        type: 'object',
        properties: {
          status: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        },
      },
    },
    {
      name: 'weekly_review',
      description: 'Get weekly review data: inbox, active/stale projects, completed tasks',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  let result: unknown

  switch (name) {
    case 'capture': {
      const input = CaptureInputSchema.parse(args)
      result = await captureTask(input, VAULT_PATH)
      break
    }
    case 'today': {
      result = await getTodayLog(VAULT_PATH)
      break
    }
    case 'add_task': {
      const input = AddTaskInputSchema.parse(args)
      result = await addTaskMcp(
        {
          filePath: input.filePath,
          text: input.text,
          section: input.section,
          dueDate: input.due,
          tags: input.tags,
          confirmed: input.confirmed,
        },
        VAULT_PATH
      )
      break
    }
    case 'complete_task': {
      const input = CompleteTaskInputSchema.parse(args)
      result = await completeTaskMcp(input, VAULT_PATH)
      break
    }
    case 'migrate_task': {
      const input = MigrateTaskInputSchema.parse(args)
      result = await migrateTaskMcp(input, VAULT_PATH)
      break
    }
    case 'query': {
      const input = QueryInputSchema.parse(args)
      result = await queryTasks(input, VAULT_PATH)
      break
    }
    case 'list_projects': {
      const input = ListProjectsInputSchema.parse(args)
      result = await listProjectsMcp(input, VAULT_PATH)
      break
    }
    case 'weekly_review': {
      result = await weeklyReviewMcp(VAULT_PATH)
      break
    }
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('Task Vault MCP server running on stdio\n')
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
