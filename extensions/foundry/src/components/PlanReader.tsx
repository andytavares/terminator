import React from 'react'
import { Button, Drawer, Markdown } from '@terminator/extension-ui'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import { Copy, X } from 'lucide-react'
import type { WorkOrder } from '../order/schema.js'
import { renderOrder } from '../order/render.js'

/** The whole plan as formatted Markdown: the same text the Line saves as order.md. */
export function PlanReader({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  const markdown = renderOrder(order)
  // A refused clipboard write changes nothing on screen; the text is still readable here.
  const copy = () => void navigator.clipboard.writeText(markdown).catch(() => undefined)
  return (
    <Drawer label={`Plan · ${order.id}`} onDismiss={onClose}>
      <div className="fdry-plan-head">
        <Button size="sm" icon={Copy} onClick={copy}>
          Copy Markdown
        </Button>
        <Button size="sm" variant="ghost" icon={X} onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="fdry-plan-body">
        <Markdown fetchesNothing className="fdry-md" onOpenLink={openInBrowser}>
          {markdown}
        </Markdown>
      </div>
      <footer className="fdry-plan-foot">.foundry/orders/{order.id}/order.md</footer>
    </Drawer>
  )
}
