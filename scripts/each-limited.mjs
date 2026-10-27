/** `work` over each item, at most `limit` at a time, results in the items' order. */
export async function eachLimited(items, limit, work) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** How many processes run at once: a core each, `bytesEach` of memory each, and no more than `most`. */
export function processesAtOnce(machine) {
  const { cores, memory, bytesEach, most } = machine
  return Math.max(1, Math.min(most, cores, Math.floor(memory / bytesEach)))
}
