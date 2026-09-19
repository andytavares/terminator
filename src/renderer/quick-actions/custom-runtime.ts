import type { CustomAction } from '../../shared/types'
import { planCustomAction, type CustomRunEnv } from './custom-actions'
import type { QuickAction } from './types'

export interface CustomRuntimeDeps {
  input(sessionId: string, data: string): void
  openTab(projectId: string): Promise<string>
  notify(message: string): void
}

function describe(a: CustomAction): string {
  if (a.kind === 'prompt') return 'prompt · Claude'
  return a.target === 'new-tab' ? 'shell · new tab' : 'shell · focused'
}

async function runAction(
  a: CustomAction,
  env: CustomRunEnv,
  deps: CustomRuntimeDeps
): Promise<void> {
  // State may have changed since the panel opened, so re-plan at run time
  // rather than trusting the plan computed when the action was built.
  const plan = planCustomAction(a, env)
  if (!plan.ok) {
    deps.notify(plan.reason)
    return
  }

  if (plan.kind === 'input') {
    deps.input(plan.sessionId, plan.data)
    return
  }

  const sessionId = await deps.openTab(plan.projectId)
  deps.input(sessionId, plan.data)
}

export function buildCustomQuickActions(
  custom: CustomAction[],
  env: CustomRunEnv,
  deps: CustomRuntimeDeps
): QuickAction[] {
  return custom.map((a) => {
    const plan = planCustomAction(a, env)
    return {
      id: `custom:${a.id}`,
      label: a.label,
      group: 'custom',
      mnemonic: a.mnemonic,
      description: describe(a),
      disabledReason: plan.ok ? undefined : plan.reason,
      run: () => runAction(a, env, deps),
    }
  })
}
