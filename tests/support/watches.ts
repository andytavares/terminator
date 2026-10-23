/** How many file watches this process holds open. */
export const openWatches = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'FSEventWrap').length
