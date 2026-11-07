import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpCall } from '../../shared/mcp/renderer-tools'
import { usePaletteState, type PaletteInputs } from '../components/QuickActionsHost'
import { answerCall, QUICK_ACTION_TOOLS } from './renderer-tools'

/** Answers the Terminator MCP server's screen tools. The quick-action list is built only while a
 * call needs it: building it reads every session, work the idle app should not pay for. The
 * extension commands in it are kept current by `useInitialLoad` (shell/bootstrap.ts). */
export function McpHost({ palette }: { palette: PaletteInputs }): React.JSX.Element | null {
  const [pending, setPending] = useState<McpCall[]>([])
  useEffect(
    // The remote browser client has no MCP API (manifest `remote: 'omit'`).
    () =>
      window.electronAPI.mcp?.onCall?.((call) => {
        if (!QUICK_ACTION_TOOLS.has(call.tool)) return void answerCall(call, [])
        setPending((calls) => [...calls, call])
      }),
    []
  )
  const done = useCallback(
    (id: string) => setPending((calls) => calls.filter((c) => c.id !== id)),
    []
  )
  if (pending.length === 0) return null
  return <QuickActionCalls calls={pending} palette={palette} onDone={done} />
}

interface QuickActionCallsProps {
  calls: McpCall[]
  palette: PaletteInputs
  onDone: (id: string) => void
}

/** Answers each pending call from the list the palette would show now. */
function QuickActionCalls({ calls, palette, onDone }: QuickActionCallsProps): null {
  const { actions } = usePaletteState(palette)
  // StrictMode runs an effect twice; a call is answered once.
  const answered = useRef(new Set<string>())
  useEffect(() => {
    for (const call of calls) {
      if (answered.current.has(call.id)) continue
      answered.current.add(call.id)
      void answerCall(call, actions).finally(() => onDone(call.id))
    }
  }, [calls, actions, onDone])
  return null
}
