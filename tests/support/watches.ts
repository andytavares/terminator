/** How many file watches this process holds open. */
export const openWatches = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'FSEventWrap').length

/** A closed watch leaves the list of active resources on the event loop's next turn. */
export const nextLoopTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
