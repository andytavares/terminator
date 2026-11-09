import type { FastifyInstance } from 'fastify'

// A bug report from the phone (ADR 156), over plain HTTP like the rest of the mobile page: the
// bridge socket would list the phone a second time under Connected now. Each route reaches one
// core channel the channel manifest declares remote-accessible.

interface BugReportRouteDeps {
  invokeChannel: (channel: string, payload: unknown) => Promise<unknown>
}

/** Five files of up to 10 MB, as base64, with room for the text. Fastify's default is 1 MiB. */
const REPORT_BODY_LIMIT = 80 * 1024 * 1024

export async function registerBugReportRoutes(
  app: FastifyInstance,
  { invokeChannel }: BugReportRouteDeps
): Promise<void> {
  app.get('/api/bug-report/status', async () => invokeChannel('bug-report:status', undefined))
  app.get('/api/bug-report/details', async () => invokeChannel('bug-report:details', undefined))
  app.post('/api/bug-report', { bodyLimit: REPORT_BODY_LIMIT }, async (request) =>
    invokeChannel('bug-report:submit-uploaded', request.body)
  )
}
