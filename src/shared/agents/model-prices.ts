// Prices in US dollars per million tokens, from the Claude API pricing table as of 2026-10-06.
export interface TokenCounts {
  input: number
  output: number
  cacheCreation: number
  cacheRead: number
}

interface ModelPrice {
  prefix: string
  input: number
  output: number
  cacheRead?: number
}

const CACHE_READ_FACTOR = 0.1
const CACHE_WRITE_FACTOR = 1.25

const PRICES: ModelPrice[] = [
  { prefix: 'claude-fable-5-1', input: 10, output: 50, cacheRead: 0.25 },
  { prefix: 'claude-fable-5', input: 10, output: 50 },
  { prefix: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2 },
  { prefix: 'claude-opus-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4-8', input: 5, output: 25 },
  { prefix: 'claude-opus-4-7', input: 5, output: 25 },
  { prefix: 'claude-opus-4-6', input: 5, output: 25 },
  { prefix: 'claude-sonnet-5-5', input: 2, output: 10, cacheRead: 0.2 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10 },
  { prefix: 'claude-sonnet-4-6', input: 3, output: 15 },
  { prefix: 'claude-haiku-5-5', input: 0.1, output: 0.5 },
  { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
].sort((a, b) => b.prefix.length - a.prefix.length)

/** The price for a model id, matched by prefix so a date suffix still finds it. */
function priceFor(model: string): ModelPrice | undefined {
  return PRICES.find((price) => model.startsWith(price.prefix))
}

/** Dollars for these tokens, or null when the model has no known price. */
export function estimateCostUsd(model: string, tokens: TokenCounts): number | null {
  const price = priceFor(model)
  if (!price) return null
  const cacheRead = price.cacheRead ?? price.input * CACHE_READ_FACTOR
  const perMillion =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheCreation * price.input * CACHE_WRITE_FACTOR +
    tokens.cacheRead * cacheRead
  return perMillion / 1_000_000
}

export function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
}

export function addTokens(into: TokenCounts, more: TokenCounts): void {
  into.input += more.input
  into.output += more.output
  into.cacheCreation += more.cacheCreation
  into.cacheRead += more.cacheRead
}

/** Total cost across models; partial when any model with tokens has no known price. */
export function costOfModels(byModel: Record<string, TokenCounts>): {
  costUsd: number
  costIsPartial: boolean
} {
  let costUsd = 0
  let costIsPartial = false
  for (const [model, tokens] of Object.entries(byModel)) {
    const cost = estimateCostUsd(model, tokens)
    if (cost === null) costIsPartial = true
    else costUsd += cost
  }
  return { costUsd, costIsPartial }
}
