import { execFileSync } from 'node:child_process'

/** This process's environment without the GIT_* variables a caller's git may have set. */
export const GIT_FREE_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
) as NodeJS.ProcessEnv

/** Runs real git in `repo` and answers its trimmed output. */
export const runGitIn = (repo: string, args: string[]) =>
  execFileSync('git', args, { cwd: repo, env: GIT_FREE_ENV, encoding: 'utf-8' }).trim()
