import type { Command } from './command-names.js'
import { flagName, schemaTypes } from './flags.js'

const GLOBAL_FLAGS: Array<[string, string]> = [
  ['--json', 'Print the raw result'],
    ['--help', 'Show help for termctl, a group or a command'],
  ['--socket <path>', "Connect to this socket instead of the app's"],
]

/** Rows of two columns, the first padded so the second lines up. */
export function columns(rows: Array<[string, string]>): string {
  const width = rows.length ? Math.max(...rows.map(([left]) => left.length)) : 0
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd()).join('\n')
}

export function commandWords(command: Command): string {
  return command.verb ? `${command.group} ${command.verb}` : command.group
}

export function rootHelp(commands: Command[]): string {
  const groups = new Map<string, string[]>()
  for (const command of commands) {
    groups.set(command.group, [...(groups.get(command.group) ?? []), command.verb ?? ''])
  }
  const rows = [...groups.keys()]
    .sort()
    .map((group): [string, string] => [group, groups.get(group)!.sort().join(', ')])
  return [
    'Usage: termctl <group> <verb> [flags]',
    '       termctl                         Open the full-screen view',
    '',
    'Groups:',
    columns(rows),
    '',
    'Global flags:',
    columns(GLOBAL_FLAGS),
    '',
  ].join('\n')
}

export function groupHelp(group: string, commands: Command[]): string {
  const rows = commands
    .filter((command) => command.group === group)
    .map((command): [string, string] => [command.verb ?? '', command.tool.description ?? ''])
    .sort()
  return [`Usage: termctl ${group} <verb> [flags]`, '', 'Verbs:', columns(rows), ''].join('\n')
}

export function commandHelp(command: Command): string {
  const { properties = {}, required = [] } = command.tool.inputSchema
  const rows = Object.entries(properties).map(([key, property]): [string, string] => {
    const types = schemaTypes(property)
    if (types.includes('boolean')) return [`--${flagName(key)}`, 'switch']
    const type = types.filter((name) => name !== 'null').join('|') || 'json'
    const notes = [
      required.includes(key) ? 'required' : '',
      types.includes('array') ? 'repeat it' : '',
    ]
    return [`--${flagName(key)} <${type}>`, notes.filter(Boolean).join(', ')]
  })
  const flags = rows.length > 0 ? ['', 'Flags:', columns(rows)] : []
  return [
    `Usage: termctl ${commandWords(command)} [flags]`,
    '',
    command.tool.description ?? '',
    ...flags,
    '',
  ].join('\n')
}
