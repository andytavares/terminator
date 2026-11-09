import type { Command } from '../command-names.js'
import { flagName, parseToolArguments, schemaTypes, type ToolArguments } from '../flags.js'
import { commandWords } from '../help.js'

export interface FormField {
  flag: string
  required: boolean
}

/** One field per flag of the command's tool. */
export function formFields(command: Command): FormField[] {
  const { properties = {}, required = [] } = command.tool.inputSchema
  return Object.keys(properties).map((key) => ({
    flag: flagName(key),
    required: required.includes(key),
  }))
}

/** The tool's arguments from the form's values, parsed as the CLI parses the same flags. */
export function formArguments(command: Command, values: string[]): ToolArguments {
  const { properties = {} } = command.tool.inputSchema
  const flags = Object.entries(properties).flatMap(([key, property], index) => {
    const value = values[index] ?? ''
    if (value === '') return []
    if (schemaTypes(property).includes('boolean')) return [`--${flagName(key)}=${value}`]
    return [`--${flagName(key)}`, value]
  })
  return parseToolArguments(command.tool.inputSchema, flags)
}

/** The commands whose words contain the query, sorted so each group's verbs sit together. */
export function matchingCommands(commands: Command[], query: string): Command[] {
  return commands
    .filter((command) => commandWords(command).includes(query.trim()))
    .sort((left, right) => commandWords(left).localeCompare(commandWords(right)))
}
