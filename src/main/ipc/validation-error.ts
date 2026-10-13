import type { z } from 'zod'

/** The response to a payload a channel's schema rejects. */
export function validationError(error: z.ZodError): { error: string; message: string } {
  return { error: 'VALIDATION_ERROR', message: error.message }
}
