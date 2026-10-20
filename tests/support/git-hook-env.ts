// A git hook exports GIT_DIR and GIT_INDEX_FILE, and a spec's `git init` or `git commit` in a
// temporary directory inherits them and writes into the real repository instead. The list is
// `git rev-parse --local-env-vars`.
const HOOK_VARIABLES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
]

/** Removes from `env` what a git hook sets to point git at its repository. */
export function forgetGitHookEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of HOOK_VARIABLES) delete env[name]
}
