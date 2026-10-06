import type { CiState } from './ci-state.js'

// Free of Node builtins: the Floor and the hall render it.
/** The words a surface shows for where CI stands. */
export function ciLabel(state: Pick<CiState, 'status' | 'round' | 'max' | 'reason'>): string {
  switch (state.status) {
    case 'watching':
      return state.round === 0
        ? `First run · up to ${state.max} ${state.max === 1 ? 'fix' : 'fixes'}`
        : `Fix ${state.round} of ${state.max}`
    case 'green':
      return 'Passed'
    case 'red':
      return `Failed after ${state.max} ${state.max === 1 ? 'fix' : 'fixes'}`
    case 'not_measured':
      return `Not measured: ${state.reason}`
    case 'reworking':
      return `Fixing: round ${state.round} of ${state.max}`
  }
}
