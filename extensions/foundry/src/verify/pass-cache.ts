type Git = (args: string[], cwd: string) => Promise<{ exitCode: number; stdout: string }>

export interface PassCache {
  record(cwd: string, command: string, exitCode: number | null): Promise<void>
  passed(cwd: string, command: string): Promise<boolean>
}

/**
 * Commands that already passed on exactly this commit of this checkout.
 *
 * The final check re-ran lint and the whole unit suite the run's own check
 * steps had just passed on the same commit, minutes of wall clock that could
 * only ever repeat the answer. A checkout with uncommitted changes has no
 * commit that describes it, so nothing is trusted there.
 */
export function createPassCache(git: Git): PassCache {
  const passes = new Set<string>()

  async function fingerprint(cwd: string): Promise<string | null> {
    const status = await git(['status', '--porcelain'], cwd)
    if (status.exitCode !== 0 || status.stdout.trim() !== '') return null
    const head = await git(['rev-parse', 'HEAD'], cwd)
    return head.exitCode === 0 ? head.stdout.trim() : null
  }

  return {
    async record(cwd, command, exitCode) {
      if (exitCode !== 0) return
      const sha = await fingerprint(cwd)
      if (sha !== null) passes.add(`${cwd}\0${sha}\0${command}`)
    },
    async passed(cwd, command) {
      const sha = await fingerprint(cwd)
      return sha !== null && passes.has(`${cwd}\0${sha}\0${command}`)
    },
  }
}
