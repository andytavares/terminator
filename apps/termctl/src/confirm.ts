import type { CommandName } from './command-names.js'

export type Confirmation = 'run' | 'refused' | 'declined'

export interface ConfirmOptions {
  yes: boolean
  /** Asks the user in the terminal. Null when there is no terminal to ask in. */
  ask: ((question: string) => Promise<string>) | null
}

/** Whether a destructive command runs: with --yes, or when the user answers yes in a terminal. */
export async function confirmDestructive(
  command: CommandName,
  { yes, ask }: ConfirmOptions
): Promise<Confirmation> {
  if (yes) return 'run'
  if (!ask) return 'refused'
  const answer = await ask(confirmQuestion(command, null))
  return /^y(es)?$/i.test(answer.trim()) ? 'run' : 'declined'
}

/** `Delete task "Docs"? [y/N] `, with the name of the thing when it is known. */
export function confirmQuestion(command: CommandName, name: string | null): string {
  const verb = command.verb ?? command.group
  const noun = command.verb ? ` ${command.group}` : ''
  const named = name === null ? '' : ` "${name}"`
  return `${verb[0].toUpperCase()}${verb.slice(1)}${noun}${named}? [y/N] `
}
