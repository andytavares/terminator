// Branch names for work that starts from a typed prompt.

const MAX_LENGTH = 50
const SEMANTIC = /^(feat|fix)\/[a-z0-9]+(-[a-z0-9]+)*$/

/** The agent's answer as a branch name (feat/… or fix/…, kebab case), or null when it is not one. */
export function semanticBranch(text: string): string | null {
  const line = text.trim().split('\n')[0]
  const cleaned = line
    .replace(/^[`'"]+|[`'".]+$/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  return SEMANTIC.test(cleaned) && cleaned.length <= MAX_LENGTH ? cleaned : null
}

/** The name used when the agent gave none in time: `prompt/` and the first four words. */
export function promptBranch(prompt: string): string {
  const words = prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return `prompt/${words.slice(0, 4).join('-') || 'work'}`
}
