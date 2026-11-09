import { createIssueService, type IssueService } from './issue-service.js'
import { createLinearProvider } from './providers/linear.provider.js'
import { getCredential, getMine, setLastError } from './tracker-store.js'

// Where the pieces are put together.
//
// One service for the whole application: the IPC layer and the extension API
// both take this, so a cached issue is shared between the sidebar badge, the
// drawer, the board and the agent context rather than fetched once each.

let service: IssueService | null = null

export function getIssueService(): IssueService {
  if (service === null) {
    service = createIssueService({
      providers: { linear: createLinearProvider() },
      getCredential,
      getMine,
      // A credential that has started failing is worth showing in settings —
      // otherwise the operator sees empty lists and blames the feature.
      onTrackerError: setLastError,
    })
  }
  return service
}

/** Tests and credential changes need the cache and the client dropped. */
export function resetIssueService(): void {
  service = null
}
