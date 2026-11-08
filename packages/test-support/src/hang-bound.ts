// The one timer test code may race against (ADR 123): a bound that only catches a hang, so a stuck
// app fails with what it was doing, or a stuck teardown escalates, instead of waiting out the
// whole test's bound. Never a wait for work to finish; that is a signal.

/** Settles as `work` does, or as `onHang()` does once `ms` has passed with no answer. */
export function orOnHang<T>(
  work: Promise<T>,
  ms: number,
  onHang: () => T | Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hung = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      Promise.resolve().then(onHang).then(resolve, reject)
    }, ms)
  })
  return Promise.race([work, hung]).finally(() => clearTimeout(timer))
}
