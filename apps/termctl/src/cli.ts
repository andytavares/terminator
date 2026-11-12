import { homedir, tmpdir } from 'node:os'
import { toCommands, type Command, type ToolInfo } from './command-names.js'
import { confirmDestructive } from './confirm.js'
import {
  EXIT_NOT_RUNNING,
  EXIT_SUCCESS,
  EXIT_TOOL_ERROR,
  EXIT_USAGE,
  UsageError,
} from './exit-codes.js'
import { parseToolArguments } from './flags.js'
import { commandHelp, commandWords, groupHelp, rootHelp } from './help.js'
import { formatResult } from './output.js'
import { socketLocation } from './socket-location.js'
import { runTui, type TuiTerminal } from './tui/run.js'

interface TextSink {
  write(text: string): unknown
}

export interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

/** The part of the MCP client termctl uses. */
export interface ToolClient {
  listTools(): Promise<{ tools: ToolInfo[] }>
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<ToolResult>
  close(): Promise<void>
}

export interface CliIo {
  stdout: TextSink
  stderr: TextSink
  env: Record<string, string | undefined>
  /** Asks the user in the terminal. Null when stdin is not a terminal. */
  ask: ((question: string) => Promise<string>) | null
  /** The terminal the full-screen view draws in. Null when stdin or stdout is not a terminal. */
  terminal: TuiTerminal | null
  connect: (socketPath: string) => Promise<ToolClient>
}

interface CommandLine {
  json: boolean
  yes: boolean
  verbose: boolean
  help: boolean
  socket: string | null
  /** The group, the verb and the tool's flags, with the global flags taken out. */
  words: string[]
}

/** Runs one termctl command line and returns its exit code. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  let line: CommandLine
  try {
    line = parseCommandLine(argv)
  } catch (error) {
    io.stderr.write(String(error))
    return EXIT_SUCCESS
  }
  const socketPath = socketLocation({
    flag: line.socket,
    env: io.env,
    home: homedir(),
    tmpDir: tmpdir(),
  })
  let client: ToolClient
  try {
    client = await io.connect(socketPath)
  } catch {
    io.stderr.write('Terminator is not running.\n')
    return EXIT_NOT_RUNNING
  }
  try {
    return await run(line, client, io)
  } catch (error) {
    return fail(io, error)
  } finally {
    await client.close()
  }
}

function parseCommandLine(argv: string[]): CommandLine {
  const line: CommandLine = { json: false, yes: false, help: false, socket: null, words: [] }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--json') line.json = true
    else if (arg === '--yes') line.yes = true
    else if (arg === '--help' || arg === '-h') line.help = true
    else if (arg.startsWith('--socket=')) line.socket = arg.slice('--socket='.length)
    else if (arg === '--socket') line.socket = socketValue(argv[++index])
    else line.words.push(arg)
  }
  return line
}

function socketValue(value: string | undefined): string {
  if (value === undefined) throw new UsageError('Flag --socket needs a value')
  return value
}

function fail(io: CliIo, error: unknown): number {
  io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  return error instanceof UsageError ? EXIT_USAGE : EXIT_TOOL_ERROR
}

async function run(line: CommandLine, client: ToolClient, io: CliIo): Promise<number> {
  const commands = toCommands((await client.listTools()).tools)
  if (line.words.length === 0) {
    if (!line.help) return runTui({ io, client, commands })
    io.stdout.write(rootHelp(commands))
    return EXIT_SUCCESS
  }
  const found = findCommand(commands, line.words)
  if (!found) return groupOnly(line, commands, io)
  if (line.help) {
    io.stdout.write(commandHelp(found.command))
    return EXIT_SUCCESS
  }
  const args = parseToolArguments(found.command.tool.inputSchema, found.flags)
  return callCommand(found.command, args, { line, client, io })
}

function findCommand(
  commands: Command[],
  [group, verb, ...rest]: string[]
): { command: Command; flags: string[] } | null {
  const bare = commands.find((command) => command.group === group && command.verb === null)
  if (bare) return { command: bare, flags: [verb, ...rest].filter((word) => word !== undefined) }
  const command = commands.find((candidate) => candidate.group === group && candidate.verb === verb)
  return command ? { command, flags: rest } : null
}

/** `termctl task`: the group's help, or a usage error when there is no such group or verb. */
function groupOnly(line: CommandLine, commands: Command[], io: CliIo): number {
  const [group, verb] = line.words
  const known = commands.some((command) => command.group === group)
  if (!known || (verb !== undefined && !verb.startsWith('--'))) {
    throw new UsageError(
      `Unknown command "${line.words.slice(0, 2).join(' ')}". Run termctl --help.`
    )
  }
  const help = groupHelp(group, commands)
  if (line.help) io.stdout.write(help)
  else io.stderr.write(help)
  return line.help ? EXIT_SUCCESS : EXIT_USAGE
}

interface CallContext {
  line: CommandLine
  client: ToolClient
  io: CliIo
}

async function callCommand(
  command: Command,
  args: Record<string, unknown>,
  { line, client, io }: CallContext
): Promise<number> {
  if (command.tool.annotations?.destructiveHint) {
    const confirmation = await confirmDestructive(command, { yes: line.yes, ask: io.ask })
    if (confirmation === 'refused') throw new UsageError(refusal(command))
    if (confirmation === 'declined') throw new UsageError('Cancelled.')
  }
  const text = await callToolText(client, command.tool.name, args)
  io.stdout.write(formatResult(text, { json: line.json }))
  return EXIT_SUCCESS
}

/** The tool's text result. Throws its text when the tool returns an error. */
export async function callToolText(
  client: ToolClient,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  const text = result.content.map((block) => block.text ?? '').join('\n')
  if (result.isError) throw new Error(text)
  return text
}

function refusal(command: Command): string {
  return `Refused: "${commandWords(command)}" is destructive. Run it in a terminal to confirm, or pass --yes.`
}
