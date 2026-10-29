import { getUsageStore, type UsageRecord } from '../usage/usage-store.js'
import { makeLogger } from '../logger.js'
import type { FeatureDeclaration } from '../../shared/schemas/usage.schema.js'

const log = makeLogger('extension-usage')

/** Counting must never break the feature it counts: a failure is logged, not thrown. */
function withStore(call: (store: ReturnType<typeof getUsageStore>) => Promise<void>): void {
  try {
    call(getUsageStore()).catch((error) => log.warn(`usage store failed: ${String(error)}`))
  } catch (error) {
    log.warn(`usage store failed: ${String(error)}`)
  }
}

export const declareUsage = (features: FeatureDeclaration[]): void =>
  withStore((store) => store.declare(features))

export const recordUsage = (input: UsageRecord): void =>
  withStore((store) => store.recordUse(input))

/** What an extension's manifest contributes that the Usage screen lists on its own. */
export function manifestUsageFeatures(
  extensionId: string,
  contributes: {
    usage?: Array<{ id: string; label: string }>
    commands?: Array<{ id: string; label: string }>
    windowViews?: Array<{ id: string; view: string }>
    insightsSection?: { label?: string }
  } = {}
): FeatureDeclaration[] {
  const source = extensionId
  const declare = (id: string, label: string, kind: FeatureDeclaration['kind']) => ({
    id: `${extensionId}.${id}`,
    label,
    kind,
    source,
  })
  return [
    ...(contributes.usage ?? []).map((item) => declare(item.id, item.label, 'control')),
    ...(contributes.commands ?? []).map((c) => declare(`command.${c.id}`, c.label, 'command')),
    ...(contributes.windowViews ?? []).map((v) => declare(v.id, v.view, 'surface')),
    ...(contributes.insightsSection
      ? [declare('insights-section', contributes.insightsSection.label ?? 'Insights', 'surface')]
      : []),
  ]
}

/** The window view a window key opens: a key is the manifest id, or the id and a suffix that
 * names one item (`notepad-note-<id>`), which never reaches the store. */
export function windowViewUsageId(key: string, windowViewIds: readonly string[]): string | null {
  return windowViewIds.find((id) => key === id || key.startsWith(`${id}-`)) ?? null
}
