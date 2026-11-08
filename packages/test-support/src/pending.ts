/** Work a test finishes itself: `done` settles once `finish` is called. */
export function unfinishedWork(): { done: Promise<void>; finish: () => void } {
  let finish = (): void => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { done, finish }
}

/** Whether `promise` has not settled yet: a settled one wins the race against the marker. */
export async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending')
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker
}
