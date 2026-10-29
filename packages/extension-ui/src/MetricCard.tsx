import React from 'react'
import './desk.css'

export interface MetricCardProps {
  /** The question the number answers: "Needs me". */
  question: string
  /** A quieter word after the question: "right now". */
  qualifier?: string
  value: React.ReactNode
  /** Small text after the value: "h", "%". */
  unit?: string
  /** A line under the value: a comparison, a count. */
  sub?: React.ReactNode
  /** A chart or list under the sub line. */
  children?: React.ReactNode
}

/** One number with its question, for the Insights page. */
export function MetricCard({
  question,
  qualifier,
  value,
  unit,
  sub,
  children,
}: MetricCardProps): React.JSX.Element {
  return (
    <div className="tmui-metric-card">
      <div className="tmui-metric-card__question">
        {question}
        {qualifier ? <span className="tmui-metric-card__qualifier"> {qualifier}</span> : null}
      </div>
      <div className="tmui-metric-card__value">
        {value}
        {unit ? <span className="tmui-metric-card__unit">{unit}</span> : null}
      </div>
      {sub ? <div className="tmui-metric-card__sub">{sub}</div> : null}
      {children ? <div className="tmui-metric-card__chart">{children}</div> : null}
    </div>
  )
}
