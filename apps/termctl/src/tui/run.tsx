import { render } from 'ink'
import type { CliIo, ToolClient } from '../cli.js'
import type { Command } from '../command-names.js'
import { EXIT_SUCCESS, EXIT_USAGE } from '../exit-codes.js'
import { rootHelp } from '../help.js'
import { TuiApp } from './app.js'

export interface TuiClock {
  now(): number
  /** Calls `run` every `ms` milliseconds; the returned function stops it. */
  every(ms: number, run: () => void): () => void
}

export interface TuiTerminal {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream & { rows?: number; columns?: number; isTTY?: boolean }
  cwd: string
  home: string
  clock: TuiClock
}

export interface TuiSession {
  io: CliIo
  client: ToolClient
  commands: Command[]
}

/** termctl with no arguments: the full-screen view, or the help when there is no terminal. */
export async function runTui({ io, client, commands }: TuiSession): Promise<number> {
  const { terminal } = io
  if (!terminal) {
    io.stdout.write(rootHelp(commands))
    return EXIT_USAGE
  }
  const app = render(<TuiApp client={client} commands={commands} terminal={terminal} />, {
    stdin: terminal.stdin,
    stdout: terminal.stdout,
    alternateScreen: true,
    patchConsole: false,
    // A stream that is not a terminal cannot redraw in place, so each frame is written whole.
    debug: !terminal.stdout.isTTY,
  })
  await app.waitUntilExit()
  return EXIT_SUCCESS
}
