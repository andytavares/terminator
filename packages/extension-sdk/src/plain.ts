// The SDK's helpers that import nothing, so a renderer can use them without loading zod.

export { HOME_MEASURES, SEND_TO_AGENT_ACTION } from './home-contract'

/** `word` when `count` is one, else its plural (`word` + "s" unless `many` is given). */
export function plural(count: number, word: string, many = `${word}s`): string {
  return count === 1 ? word : many
}
