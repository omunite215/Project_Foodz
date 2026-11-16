import { DbClient } from '@tanstack/react-db';
import { isServer, QueryClient } from '@tanstack/react-query';

export interface DataClients {
  queryClient: QueryClient;
  dbClient: DbClient;
}

/** Client errors (bad input, no access) will fail the same way again, so they are not retried. */
function isClientError(error: unknown) {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function makeClients(): DataClients {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data handed over from a server render stays fresh long enough not to be refetched
        // straight after hydration.
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 2 && !isClientError(error),
      },
    },
  });
  // Query-backed collections look the QueryClient up on the DbClient.
  return { queryClient, dbClient: new DbClient({ queryClient }) };
}

let browserClients: DataClients | undefined;

/**
 * A fresh pair for every server render, so no state is shared between requests, and one pair
 * for the lifetime of the browser tab.
 */
export function getDataClients(): DataClients {
  if (isServer) return makeClients();
  browserClients ??= makeClients();
  return browserClients;
}
