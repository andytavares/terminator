// Sensors read the product's signals back into the factory (ADR-066). A signal
// proposes work; it never starts any. Promoting one seeds a draft the Forge
// still has to converge.

export type Severity = 'low' | 'medium' | 'high'

export const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = { low: 1, medium: 3, high: 9 }

export type SensorSource =
  | { readonly kind: 'github-runs'; readonly branch: string | null; readonly limit: number }
  | { readonly kind: 'github-issues'; readonly label: string; readonly limit: number }
  | { readonly kind: 'tracker'; readonly query: string | null; readonly limit: number }

export interface SensorDef {
  readonly id: string
  readonly description: string
  /** How often it runs while the app is open: `<n>m` or `<n>h`. */
  readonly every: string
  readonly source: SensorSource
  readonly severity: Severity
}

export interface SignalEvidence {
  readonly kind: 'ci-run' | 'issue'
  readonly title: string
  readonly url: string
  readonly at: string
}

/** One thing a collector saw, before clustering. */
export interface SensedItem {
  /** What makes two items the same signal. */
  readonly key: string
  readonly title: string
  readonly evidence: SignalEvidence
}

export interface Signal {
  readonly id: string
  readonly sensorId: string
  readonly key: string
  readonly title: string
  readonly evidence: readonly SignalEvidence[]
  readonly occurrences: number
  readonly severity: Severity
  readonly firstSeen: string
  readonly lastSeen: string
  readonly status: 'open' | 'promoted' | 'dismissed'
  /** Occurrences when it was dismissed; it reopens once it grows by half again. */
  readonly dismissedAt: number | null
  readonly orderId: string | null
}

export function impactOf(signal: Pick<Signal, 'occurrences' | 'severity'>): number {
  return signal.occurrences * SEVERITY_WEIGHT[signal.severity]
}
