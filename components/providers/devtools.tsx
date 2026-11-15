'use client';

import { TanStackDevtools } from '@tanstack/react-devtools';
import { formDevtoolsPlugin } from '@tanstack/react-form-devtools';
import { pacerDevtoolsPlugin } from '@tanstack/react-pacer-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { tableDevtoolsPlugin } from '@tanstack/react-table-devtools';

/** One panel for every TanStack library, loaded only in development. */
export function Devtools() {
  return (
    <TanStackDevtools
      // Bottom-left belongs to the Next.js dev indicator.
      config={{ position: 'bottom-right' }}
      // The server event bus needs a separate local server; without it the panel would try
      // to open a socket the CSP does not allow.
      eventBusConfig={{ connectToServerBus: false }}
      plugins={[
        { id: 'tanstack-query', name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> },
        formDevtoolsPlugin(),
        pacerDevtoolsPlugin(),
        tableDevtoolsPlugin(),
      ]}
    />
  );
}
