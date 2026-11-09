import { onChannel } from './channel-registrar.js'
import { writeFromRenderer, type LogLevel } from '../logger.js'

export function registerLogHandlers(): void {
  onChannel(
    'log:write',
    (_event, payload: { level: LogLevel; namespace: string; message: string }) => {
      const { level, namespace, message } = payload ?? {}
      if (!level || !namespace || typeof message !== 'string') return
      writeFromRenderer(level, namespace, message)
    }
  )
}
