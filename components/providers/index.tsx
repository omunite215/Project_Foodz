'use client';

import { DbProvider } from '@tanstack/react-db';
import { QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { type ReactNode, useEffect } from 'react';
import { getDataClients } from '@/lib/data/clients';

// Development only: production builds drop this branch, so the devtools never ship.
const Devtools =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('./devtools').then((module) => module.Devtools), { ssr: false })
    : () => null;

export function Providers({ children }: { children: ReactNode }) {
  const { queryClient, dbClient } = getDataClients();

  // Parents' effects run after their children's, so this marks the first commit of the whole page
  // as done: browser tests wait for it instead of guessing from network quiet.
  useEffect(() => {
    document.documentElement.dataset.hydrated = '';
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <DbProvider client={dbClient}>
        {children}
        <Devtools />
      </DbProvider>
    </QueryClientProvider>
  );
}
