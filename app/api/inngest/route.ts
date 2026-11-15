import { serve } from 'inngest/next';
import { inngest, isInngestDevMode } from '@/server/jobs/client';
import { functions } from '@/server/jobs';

// Inngest calls this endpoint to run jobs. Outside dev mode every request must carry a valid
// signature made with INNGEST_SIGNING_KEY; anything else is rejected before a job runs.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  // Register the configured public URL, never one taken from the request: an unsigned sync
  // request with a forged Host header would otherwise point Inngest at someone else's server.
  // (In dev mode the local Inngest server is told the app's URL directly.)
  ...(isInngestDevMode()
    ? {}
    : { serveOrigin: process.env.NEXT_PUBLIC_SITE_URL, servePath: '/api/inngest' }),
});
