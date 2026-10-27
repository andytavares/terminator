/** A channel's answer when it did not refuse; a refusal fails the spec with its reason. */
export function answered<T extends object>(answer: T): Exclude<T, { error: string }> {
  if ('error' in answer && typeof answer.error === 'string') {
    throw new Error(`the channel refused: ${answer.error}`)
  }
  return answer as Exclude<T, { error: string }>
}
