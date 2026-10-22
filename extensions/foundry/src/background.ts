// Work Foundry starts that no caller awaits: a run, the next Forge turn, a ledger line. Each keeps
// writing records until it ends, so whatever must outlast it (a spec's folder) can wait for it.

const inFlight = new Set<Promise<unknown>>()

/** Keeps `work` until it settles, returned or failed; reporting a failure is the work's own job. */
export function inBackground(work: Promise<unknown>): void {
  const forget = (): void => {
    inFlight.delete(work)
  }
  inFlight.add(work)
  work.then(forget, forget)
}

/** Settles once all the work started in the background has. */
export async function settleBackground(): Promise<void> {
  await Promise.allSettled([...inFlight])
}
