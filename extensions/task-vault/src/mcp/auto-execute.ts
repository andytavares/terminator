import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const SETTINGS_FILE = '.todo/settings.json'

interface Settings {
  mcpAutoExecute?: {
    capture?: boolean
    add_task?: boolean
    complete_task?: boolean
    migrate_task?: boolean
    process_inbox_item?: boolean
  }
}

async function readSettings(vaultPath: string): Promise<Settings> {
  try {
    const content = await fs.readFile(path.join(vaultPath, SETTINGS_FILE), 'utf-8')
    return JSON.parse(content) as Settings
  } catch {
    return {}
  }
}

export async function getAutoExecuteSetting(toolName: string, vaultPath: string): Promise<boolean> {
  const settings = await readSettings(vaultPath)
  const autoExecute = settings.mcpAutoExecute ?? {}
  return (autoExecute as Record<string, boolean>)[toolName] ?? false
}

export interface MCPSuggestion {
  suggestion: string
  tool: string
  description: string
}

export function makeSuggestion(toolName: string, description: string): MCPSuggestion {
  return {
    suggestion: `This action requires confirmation. Re-run with confirmed: true or enable auto-execute for '${toolName}' in settings.`,
    tool: toolName,
    description,
  }
}
